import type { ReasonerAgent } from './types.js';
import type { ReasoningOutput } from '../types.js';
import { loadRolePrompt } from '../utils/roles.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import { findEvidenceForClaim } from '../tools/evidence.js';
import { applyPromptTemplate } from '../utils/prompt.js';
import { AVAILABLE_PROTOCOLS, DISCUSSION_URL } from '../utils/x23Config.js';
import { SchemaNames, TraceLabels } from './constants.js';

// LLM prompts (editable)
const REASONER_PROMPT_SYSTEM_SUFFIX = [
  'Form structured reasoning for the proposal, grounded in the vetted facts and planning objectives.',
  'Begin the argument with a short section exactly titled "Purpose Breakdown:" that lists stakeholder purposes as concise bullets for: proposers, voters, protocol stewards, and affected users. Reflect the proposal context, not generic platitudes.',
  'Question the overarching goal/purpose of the proposal and relate stakeholder purposes to that goal (alignments/tensions).',
  'When evidence is provided, use it to inform premises and highlight gaps. Use inline citation markers like (R1), (R2) corresponding to numbered evidence under each premise in the provided evidenceDigest. Be explicit about uncertainties.',
  'Output JSON must include a numeric confidence in [0,1].',
].join('\n');

// Decision prompt to determine whether another search+refine iteration is warranted
const REASONER_ITER_DECISION_SUFFIX = [
  'You decide whether to run another search+refine iteration.',
  '- Continue if any of the following hold: (a) open uncertainties remain; (b) conflicting premises detected; (c) missing citations for critical premises; (d) official/policy guidance likely exists but not consulted.',
  '- Stop if returns are diminishing, evidence is sufficient for the decision context, or further search is unlikely to change conclusions.',
  'Checklist: openUncertainties?, conflictingPremises?, missingCitations?, likelyOfficialGuidance?.',
  'Return JSON { continue: boolean, rationale: string } only.',
].join('\n');

// Suggest information needs and hints to improve retrieval for a premise
const REASONER_INFO_NEEDS_SUFFIX = [
  'You suggest concrete information needs for a premise to improve retrieval.',
  '- Output short hints (3-8 words) that include entities, identifiers, policy names, or document types to search.',
  '- If specific protocols or item types are indicated, include them as lists.',
  'Return JSON { hints: string[], protocols?: string[], itemTypes?: string[] } only.',
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
    const schemaName = SchemaNames.reasoning();
    const traceLabel = TraceLabels.reasoning();
    const out = await llm.extractJSON<ReasoningOutput>(
      `${role}\n\n${REASONER_PROMPT_SYSTEM_SUFFIX}`,
      JSON.stringify(input).slice(0, 6000),
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
      { schemaName, maxOutputTokens: 6000 }
    );
    let current = {
      argument: out.argument || '',
      premises: out.premises || [],
      uncertainties: out.uncertainties || [],
      confidence: out.confidence,
    } as ReasoningOutput;

    ctx.trace.addStep({
      type: 'reasoning',
      description: traceLabel,
      output: { premises: current.premises, outline: current.argument },
    });

    // Iterative search + refine loop for deeper context
    const maxPremises = Math.max(0, Number(process.env.REASONER_PREMISE_EVIDENCE_MAX || '3'));
    const maxIters = Math.max(1, Number(process.env.REASONER_REFINE_ITERS || '2'));
    const attemptsByPremise = new Map<string, any[]>();
    for (let iter = 0; iter < maxIters; iter++) {
      // Evidence lookup for top premises in this iteration
      const evidenceByPremise: Array<{
        premise: string;
        docs: { title?: string; uri?: string; snippet?: string }[];
      }> = [];
      const searchAttempts: any[] = [];
      const seenUris = new Set<string>();
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
              { schemaName: 'reasonerInfoNeeds', maxOutputTokens: 2500 }
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
            { seenUris, priorAttempts: prior }
          );
          if (Array.isArray((ev as any).attempts)) searchAttempts.push(...(ev as any).attempts);
          if (!attemptsByPremise.has(premise)) attemptsByPremise.set(premise, []);
          attemptsByPremise.get(premise)!.push(...((ev as any).attempts || []));
          const docs = (ev.docs || [])
            .slice(0, 5)
            .map((d) => ({ title: d.title, uri: d.uri, snippet: d.snippet }));
          evidenceByPremise[i] = { premise, docs };
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

      const evidenceDigest = evidenceByPremise
        .map((e, idx) => {
          const lines = e.docs
            .slice(0, 3)
            .map(
              (d, j) => ` [${j + 1}] ${d.title || d.uri} :: ${d.uri || ''} :: ${d.snippet || ''}`
            )
            .join('\n');
          return `Premise ${idx + 1}: ${e.premise}\n${lines}`;
        })
        .join('\n');

      const refined = await llm.extractJSON<ReasoningOutput>(
        `${role}\n\n${REASONER_PROMPT_SYSTEM_SUFFIX}`,
        JSON.stringify({ ...input, draft: current, evidenceDigest, iteration: iter + 1 }),
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
        { schemaName: 'reasoningOutRefined', maxOutputTokens: 10000 }
      );

      const uniqueCitations = Array.from(
        new Set(evidenceByPremise.flatMap((e) => e.docs.map((d) => d.uri || '')).filter(Boolean))
      );
      ctx.trace.addStep({
        type: 'reasoning',
        description: `Refined reasoning with evidence context (iter ${iter + 1})`,
        input: {
          evidenceCount: evidenceByPremise.reduce((n, e) => n + e.docs.length, 0),
          searchAttempts: searchAttempts.length,
        },
        output: { confidence: refined.confidence ?? null, uniqueCitations: uniqueCitations.length },
        references: uniqueCitations.slice(0, 8).map((u) => ({ source: 'search', uri: u })),
      });

      // Convergence/decision check
      const sameArgument = (refined.argument || '').trim() === (current.argument || '').trim();
      const samePremises =
        JSON.stringify(refined.premises || []) === JSON.stringify(current.premises || []);
      const sameUncertainties =
        JSON.stringify(refined.uncertainties || []) === JSON.stringify(current.uncertainties || []);
      let shouldContinue = !sameArgument || !samePremises || !sameUncertainties;
      try {
        const decision = await llm.extractJSON<{ continue: boolean; rationale?: string }>(
          `${role}\n\n${REASONER_ITER_DECISION_SUFFIX}`,
          JSON.stringify({
            iteration: iter + 1,
            maxIters,
            current: current,
            refined: {
              argument: refined.argument,
              premises: refined.premises,
              uncertainties: refined.uncertainties,
              confidence: refined.confidence,
            },
          }).slice(0, 5000),
          {
            type: 'object',
            properties: { continue: { type: 'boolean' }, rationale: { type: 'string' } },
            required: ['continue'],
          },
          { schemaName: 'reasonerIterDecision', maxOutputTokens: 2000 }
        );
        // Combine structural convergence with model decision; both must suggest continuing to do another round
        shouldContinue = shouldContinue && !!decision?.continue;
        ctx.trace.addStep({
          type: 'reasoning',
          description: `Iteration decision (iter ${iter + 1})`,
          input: { sameArgument, samePremises, sameUncertainties },
          output: { continue: !!decision?.continue, rationale: decision?.rationale || null },
        });
      } catch {
        // if decision fails, fallback to structural convergence only
      }
      current = {
        argument: refined.argument || current.argument,
        premises: refined.premises && refined.premises.length ? refined.premises : current.premises,
        uncertainties: refined.uncertainties || current.uncertainties,
        confidence: refined.confidence ?? current.confidence,
      };
      if (!shouldContinue) break;
    }

    return current;
  },
};
