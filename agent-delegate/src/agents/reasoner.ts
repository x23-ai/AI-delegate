import type { ReasonerAgent } from './types.js';
import type { ReasoningOutput } from '../types.js';
import { loadRolePrompt } from '../utils/roles.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import { findEvidenceForClaim } from '../tools/evidence.js';
import { applyPromptTemplate } from '../utils/prompt.js';
import { AVAILABLE_PROTOCOLS, DISCUSSION_URL } from '../utils/x23Config.js';
import { SchemaNames, TraceLabels } from './constants.js';
import { log } from '../utils/logger.js';

// LLM prompts (editable)
const REASONER_PROMPT_SYSTEM_SUFFIX = [
  'Form structured reasoning for the proposal, grounded in the vetted facts and planning objectives.',
  'Begin the argument with a short section exactly titled "Purpose Breakdown:" that lists stakeholder purposes as concise bullets for: proposers, voters, protocol stewards, and affected users. Reflect the proposal context, not generic platitudes.',
  'Question the overarching goal/purpose of the proposal and relate stakeholder purposes to that goal (alignments/tensions).',
  'When evidence is provided, use it to inform premises and highlight gaps. Use inline citation markers like (R1), (R2) corresponding to numbered evidence under each premise in the provided evidenceDigest. Be explicit about uncertainties.',
  'Focus narrowly on the three aspects provided in the input under "aspects"; make premises and discussion primarily about these aspects.',
  'Output JSON must include a numeric confidence in [0,1].',
].join('\n');

// Decide whether collected evidence is sufficient to proceed to reasoning
const REASONER_EVIDENCE_SUFFICIENCY_SUFFIX = [
  'You decide whether collected evidence is sufficient to form a well-grounded recommendation.',
  '- Consider the provided aspects/premises, the number and diversity of citations, and whether official/policy guidance has been consulted when relevant.',
  '- Stop searching if returns are diminishing and coverage seems adequate for the decision context; otherwise suggest what is missing.',
  'Return JSON { enough: boolean, rationale: string, missing?: string[] } only.',
].join('\n');

// Suggest information needs and hints to improve retrieval for a premise
const REASONER_INFO_NEEDS_SUFFIX = [
  'You suggest concrete information needs for a premise to improve retrieval.',
  '- Output short hints (3-8 words) that include entities, identifiers, policy names, or document types to search.',
  '- If specific protocols or item types are indicated, include them as lists.',
  'Return JSON { hints: string[], protocols?: string[], itemTypes?: string[] } only.',
].join('\n');

// Identify the top 3 aspects to focus on
const REASONER_ASPECTS_SUFFIX = [
  'Identify the top 3 most important aspects of this proposal to assess.',
  '- Think in terms of decision-impacting dimensions (e.g., feasibility, compliance, expected outcomes, risk).',
  '- Return JSON { aspects: string[3] } with concise, non-overlapping aspect labels.',
].join('\n');

export const CogitoSage: ReasonerAgent = {
  kind: 'reasoner',
  codename: 'Cogito Sage',
  systemPromptPath: 'src/agents/roles/reasoner.md',
  async run(ctx): Promise<ReasoningOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const baseRole = loadRolePrompt(CogitoSage.systemPromptPath);
    const role = applyPromptTemplate(baseRole, {
      protocols: AVAILABLE_PROTOCOLS.join(', '),
      forumRoot: DISCUSSION_URL,
    });
    const facts: any = ctx.cache?.get('facts') || {};
    const planning: any = ctx.cache?.get('planning') || {};
    const input = {
      proposal: {
        id: ctx.proposal.id,
        title: ctx.proposal.title,
        description: ctx.proposal.description,
      },
      planning,
      facts,
    };
    // Step numbering for trace/log readability
    let stepNum = 1;

    // Identify top 3 aspects to focus the reasoning
    let aspects: string[] = [];
    try {
      log.info('Reasoner: identifying top 3 aspects to focus on');
      const aspectsOut = await llm.extractJSON<{ aspects: string[] }>(
        `${role}\n\n${REASONER_ASPECTS_SUFFIX}`,
        JSON.stringify({
          proposal: input.proposal,
          planning: input.planning,
          factsSummary: {
            assumptions: Array.isArray(facts?.claims)
              ? facts.claims.slice(0, 8).map((c: any) => c.claim)
              : [],
          },
        }).slice(0, 3000),
        {
          type: 'object',
          properties: { aspects: { type: 'array', items: { type: 'string' } } },
          required: ['aspects'],
        },
        { schemaName: 'reasonerAspects', maxOutputTokens: 1500, difficulty: 'easy' }
      );
      aspects = (aspectsOut.aspects || []).slice(0, 3);
    } catch {}
    ctx.trace.addStep({
      type: 'reasoning',
      description: `[R${stepNum++}] Identified top aspects`,
      output: { aspects },
    });

    const schemaName = SchemaNames.reasoning();
    const traceLabel = TraceLabels.reasoning();
    log.info('Reasoner: drafting initial argument focused on key aspects');
    const out = await llm.extractJSON<ReasoningOutput>(
      `${role}\n\n${REASONER_PROMPT_SYSTEM_SUFFIX}`,
      JSON.stringify({ ...input, aspects }).slice(0, 6000),
      {
        type: 'object',
        properties: {
          argument: { type: 'string' },
          premises: { type: 'array', items: { type: 'string' } },
          uncertainties: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
        required: ['argument', 'premises', 'confidence'],
      },
      { schemaName, maxOutputTokens: 6000, difficulty: 'normal' }
    );
    let current = {
      argument: out.argument || '',
      premises: out.premises || [],
      uncertainties: out.uncertainties || [],
      confidence: out.confidence,
    } as ReasoningOutput;

    ctx.trace.addStep({
      type: 'reasoning',
      description: `[R${stepNum++}] ${traceLabel}`,
      output: { premises: current.premises, outline: current.argument },
    });

    // Stage 1: evidence collection loop
    const maxPremises = Math.max(0, Number(process.env.REASONER_PREMISE_EVIDENCE_MAX || '3'));
    const maxIters = Math.max(1, Number(process.env.REASONER_REFINE_ITERS || '2'));
    const attemptsByPremise = new Map<string, any[]>();
    const aggEvidenceByPremise = new Map<
      string,
      { title?: string; uri?: string; snippet?: string }[]
    >();
    for (let iter = 0; iter < maxIters; iter++) {
      log.info(`Reasoner: evidence iteration ${iter + 1} — collecting context for top premises`);
      const evidenceByPremise: Array<{
        premise: string;
        docs: { title?: string; uri?: string; snippet?: string }[];
      }> = [];
      const searchAttempts: any[] = [];
      const premises = current.premises || [];
      const targets = premises.slice(0, Math.min(maxPremises, premises.length));
      const conc = Math.max(1, Number(process.env.REASONER_EVIDENCE_CONCURRENCY || '2'));
      // Derive information needs (hints) per target to adapt tool calls this iteration
      const infoNeeds: Record<string, string[]> = {};
      try {
        await Promise.all(
          targets.map(async (premise) => {
            const needs = await llm.extractJSON<{
              hints: string[];
              protocols?: string[];
              itemTypes?: string[];
            }>(
              `${role}\n\n${REASONER_INFO_NEEDS_SUFFIX}`,
              JSON.stringify({
                premise,
                argument: current.argument?.slice(0, 1200),
                uncertainties: current.uncertainties?.slice(0, 6),
                title: ctx.proposal.title,
              }).slice(0, 2000),
              {
                type: 'object',
                properties: {
                  hints: { type: 'array', items: { type: 'string' } },
                  protocols: { type: 'array', items: { type: 'string' } },
                  itemTypes: { type: 'array', items: { type: 'string' } },
                },
                required: ['hints'],
              },
              { schemaName: 'reasonerInfoNeeds', maxOutputTokens: 2500, difficulty: 'normal' }
            );
            infoNeeds[premise] = Array.isArray(needs?.hints) ? needs.hints : [];
          })
        );
      } catch {}

      async function worker(startIdx: number) {
        for (let i = startIdx; i < targets.length; i += conc) {
          const premise = targets[i];
          const baseHints = [
            'policy',
            'charter',
            'manual',
            'law',
            'governance rules',
            'prior decisions',
          ];
          const extraHints = infoNeeds[premise] || [];
          const prior = attemptsByPremise.get(premise) || [];
          const ev = await findEvidenceForClaim(
            ctx,
            llm,
            role,
            premise,
            baseHints.concat(extraHints).slice(0, 12),
            { priorAttempts: prior }
          );
          if (Array.isArray((ev as any).attempts)) searchAttempts.push(...(ev as any).attempts);
          if (!attemptsByPremise.has(premise)) attemptsByPremise.set(premise, []);
          attemptsByPremise.get(premise)!.push(...((ev as any).attempts || []));
          const docs = (ev.docs || [])
            .slice(0, 5)
            .map((d) => ({ title: d.title, uri: d.uri, snippet: d.snippet }));
          evidenceByPremise[i] = { premise, docs };
          const prev = aggEvidenceByPremise.get(premise) || [];
          const prevUris = new Set(prev.map((d) => d.uri || ''));
          const merged = prev.concat(docs.filter((d) => d.uri && !prevUris.has(d.uri)));
          aggEvidenceByPremise.set(premise, merged);
          ctx.trace.addStep({
            type: 'reasoning',
            description: `Collected evidence for premise ${i + 1} (iter ${iter + 1})`,
            input: { premise },
            output: { docs: docs.map((d) => ({ title: d.title, uri: d.uri })) },
            references: docs.slice(0, 5).map((d) => ({ source: 'search', uri: d.uri || '' })),
          });
        }
      }
      await Promise.allSettled(
        Array.from({ length: Math.min(conc, targets.length) }, (_, k) => worker(k))
      );
      // Log which API calls were made with their queries and result counts
      for (const att of searchAttempts) {
        const q = typeof att.query === 'string' ? att.query : '';
        const tool = att.tool || 'unknown';
        const res = typeof att.resultCount === 'number' ? att.resultCount : '?';
        log.info(`Reasoner API call: tool=${tool} query="${q}" results=${res}`);
      }

      // Build aggregated evidence digest so far and decide if enough
      const evidenceDigest = Array.from(aggEvidenceByPremise.entries())
        .map(([premise, docs], idx) => {
          const lines = (docs || [])
            .slice(0, 3)
            .map(
              (d, j) => ` [${j + 1}] ${d.title || d.uri} :: ${d.uri || ''} :: ${d.snippet || ''}`
            )
            .join('\n');
          return `Premise ${idx + 1}: ${premise}\n${lines}`;
        })
        .join('\n');

      let shouldContinue = iter < maxIters - 1;
      try {
        const suff = await llm.extractJSON<{
          enough: boolean;
          rationale?: string;
          missing?: string[];
        }>(
          `${role}\n\n${REASONER_EVIDENCE_SUFFICIENCY_SUFFIX}`,
          JSON.stringify({
            iteration: iter + 1,
            maxIters,
            aspects,
            premises: targets,
            evidenceDigest,
          }).slice(0, 6000),
          {
            type: 'object',
            properties: {
              enough: { type: 'boolean' },
              rationale: { type: 'string' },
              missing: { type: 'array', items: { type: 'string' } },
            },
            required: ['enough'],
          },
          { schemaName: 'reasonerEvidenceSufficiency', maxOutputTokens: 2000, difficulty: 'normal' }
        );
        shouldContinue = !suff?.enough && shouldContinue;
        ctx.trace.addStep({
          type: 'reasoning',
          description: `[R${stepNum++}] Evidence sufficiency decision (iter ${iter + 1})`,
          output: {
            continue: shouldContinue,
            enough: !!suff?.enough,
            rationale: suff?.rationale || null,
            missing: (suff?.missing || []).slice(0, 3),
          },
        });
      } catch {}
      if (!shouldContinue) break;
    }

    // Stage 2: final reasoning over collected evidence
    const evidenceDigestFinal = Array.from(aggEvidenceByPremise.entries())
      .map(([premise, docs], idx) => {
        const lines = (docs || [])
          .slice(0, 4)
          .map((d, j) => ` [${j + 1}] ${d.title || d.uri} :: ${d.uri || ''} :: ${d.snippet || ''}`)
          .join('\n');
        return `Premise ${idx + 1}: ${premise}\n${lines}`;
      })
      .join('\n');

    const finalOut = await llm.extractJSON<ReasoningOutput>(
      `${role}\n\n${REASONER_PROMPT_SYSTEM_SUFFIX}`,
      JSON.stringify({ ...input, aspects, evidenceDigest: evidenceDigestFinal }).slice(0, 10000),
      {
        type: 'object',
        properties: {
          argument: { type: 'string' },
          premises: { type: 'array', items: { type: 'string' } },
          uncertainties: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
        required: ['argument', 'premises', 'confidence'],
      },
      { schemaName: 'reasoningOutFinal', maxOutputTokens: 15000, difficulty: 'hard' }
    );

    ctx.trace.addStep({
      type: 'reasoning',
      description: `[R${stepNum++}] Final reasoning from collected evidence`,
      output: {
        premises: finalOut.premises,
        outline: finalOut.argument,
        confidence: finalOut.confidence,
      },
    });

    return {
      argument: finalOut.argument || current.argument,
      premises:
        finalOut.premises && finalOut.premises.length ? finalOut.premises : current.premises,
      uncertainties: finalOut.uncertainties || current.uncertainties,
      confidence: finalOut.confidence ?? current.confidence,
    } as ReasoningOutput;
  },
};
