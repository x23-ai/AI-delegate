import type { DevilsAdvocateAgent } from './types.js';
import type { ChallengeOutput } from '../types.js';
import { loadRolePrompt } from '../utils/roles.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import { findEvidenceForClaim } from '../tools/evidence.js';
import { applyPromptTemplate } from '../utils/prompt.js';
import { AVAILABLE_PROTOCOLS, DISCUSSION_URL } from '../utils/x23Config.js';

// LLM prompts (editable)
const DEVILS_ADVOCATE_PROMPT_SYSTEM_SUFFIX =
  'Stress-test the current reasoning and surface substantive counterpoints and failure modes. When evidence is provided, use it to identify overlooked risks, constraints, and conflicting guidance. Use inline citation markers like (R1), (R2) corresponding to numbered evidence under each premise in the provided evidenceDigest. Output JSON must include a numeric confidence in [0,1].';

export const RedTeamRaven: DevilsAdvocateAgent = {
  kind: 'devilsAdvocate',
  codename: 'Red Team Raven',
  systemPromptPath: 'src/agents/roles/devils-advocate.md',
  async run(ctx): Promise<ChallengeOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const baseRole = loadRolePrompt(RedTeamRaven.systemPromptPath);
    const role = applyPromptTemplate(baseRole, {
      protocols: AVAILABLE_PROTOCOLS.join(', '),
      forumRoot: DISCUSSION_URL,
    });
    const reasoning: any = ctx.cache?.get('reasoning') || {};
    const facts: any = ctx.cache?.get('facts') || {};
    // Gather external evidence around key premises to ground the challenge
    const premises: string[] = Array.isArray(reasoning?.premises) ? reasoning.premises : [];
    const maxPremises = Math.max(0, Number(process.env.DEVILS_PREMISE_EVIDENCE_MAX || '3'));
    const evidenceByPremise: Array<{
      premise: string;
      docs: { title?: string; uri?: string; snippet?: string }[];
    }> = [];
    const seenUris = new Set<string>();
    const attempts: any[] = [];
    const targets = premises.slice(0, Math.min(maxPremises, premises.length));
    const conc = Math.max(1, Number(process.env.DEVILS_EVIDENCE_CONCURRENCY || '2'));
    async function worker(startIdx: number) {
      for (let i = startIdx; i < targets.length; i += conc) {
        const premise = targets[i];
        const ev = await findEvidenceForClaim(
          ctx,
          llm,
          role,
          premise,
          ['risk', 'constraint', 'policy conflict', 'opposition'],
          { seenUris }
        );
        if (Array.isArray((ev as any).attempts)) attempts.push(...(ev as any).attempts);
        const docs = (ev.docs || [])
          .slice(0, 5)
          .map((d) => ({ title: d.title, uri: d.uri, snippet: d.snippet }));
        evidenceByPremise[i] = { premise, docs };
        ctx.trace.addStep({
          type: 'challenge',
          description: `Collected evidence for premise ${i + 1} (challenge)`,
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
          .map((d, j) => ` [${j + 1}] ${d.title || d.uri} :: ${d.uri || ''} :: ${d.snippet || ''}`)
          .join('\n');
        return `Premise ${idx + 1}: ${e.premise}\n${lines}`;
      })
      .join('\n');
    const input = { reasoning, facts, evidenceDigest };
    const { SchemaNames, TraceLabels } = await import('./constants.js');
    const schemaName = SchemaNames.devils();
    const traceLabel = TraceLabels.devils();
    const out = await llm.extractJSON<ChallengeOutput>(
      `${role}\n\n${DEVILS_ADVOCATE_PROMPT_SYSTEM_SUFFIX}`,
      JSON.stringify(input).slice(0, 6000),
      {
        type: 'object',
        properties: {
          counterpoints: { type: 'array', items: { type: 'string' } },
          failureModes: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
        required: ['counterpoints', 'confidence'],
      },
      { schemaName, maxOutputTokens: 4000 }
    );
    const counterpoints = out.counterpoints || [];
    const failureModes = out.failureModes || [];

    const uniqueCitations = Array.from(
      new Set(evidenceByPremise.flatMap((e) => e.docs.map((d) => d.uri || '')).filter(Boolean))
    );
    ctx.trace.addStep({
      type: 'challenge',
      description: traceLabel,
      input: {
        evidenceCount: evidenceByPremise.reduce((n, e) => n + e.docs.length, 0),
        searchAttempts: attempts.length,
      },
      output: {
        counterpoints,
        failureModes,
        confidence: out.confidence ?? null,
        uniqueCitations: uniqueCitations.length,
      },
      references: uniqueCitations.slice(0, 8).map((u) => ({ source: 'search', uri: u })),
    });

    return { counterpoints, failureModes, confidence: out.confidence };
  },
};
