import type { DevilsAdvocateAgent } from './types.js';
import type { ChallengeOutput } from '../types.js';
import { loadRolePrompt } from '../utils/roles.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import { findEvidenceForClaim } from '../tools/evidence.js';

// LLM prompts (editable)
const DEVILS_ADVOCATE_PROMPT_SYSTEM_SUFFIX =
  "Stress-test the current reasoning and surface substantive counterpoints and failure modes. When evidence is provided, use it to identify overlooked risks, constraints, and conflicting guidance. Output JSON must include a numeric confidence in [0,1].";

export const RedTeamRaven: DevilsAdvocateAgent = {
  kind: 'devilsAdvocate',
  codename: "Red Team Raven",
  systemPromptPath: 'src/agents/roles/devils-advocate.md',
  async run(ctx): Promise<ChallengeOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const role = loadRolePrompt(RedTeamRaven.systemPromptPath);
    const reasoning: any = ctx.cache?.get('reasoning') || {};
    const facts: any = ctx.cache?.get('facts') || {};
    // Gather external evidence around key premises to ground the challenge
    const premises: string[] = Array.isArray(reasoning?.premises) ? reasoning.premises : [];
    const maxPremises = Math.max(0, Number(process.env.DEVILS_PREMISE_EVIDENCE_MAX || '3'));
    const evidenceByPremise: Array<{ premise: string; docs: { title?: string; uri?: string; snippet?: string }[] }>= [];
    for (let i = 0; i < Math.min(maxPremises, premises.length); i++) {
      const premise = premises[i];
      const ev = await findEvidenceForClaim(ctx, llm, role, premise, ['risk', 'constraint', 'policy conflict', 'opposition']);
      const docs = (ev.docs || []).slice(0, 5).map((d) => ({ title: d.title, uri: d.uri, snippet: d.snippet }));
      evidenceByPremise.push({ premise, docs });
      ctx.trace.addStep({
        type: 'challenge',
        description: `Collected evidence for premise ${i + 1} (challenge)`,
        input: { premise },
        output: { docs: docs.map((d) => ({ title: d.title, uri: d.uri })) },
        references: docs.slice(0, 5).map((d) => ({ source: 'search', uri: d.uri || '' })),
      });
    }
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
    const schemaName = process.env.DEVILS_SCHEMA_NAME || 'challengeOut';
    const traceLabel = process.env.DEVILS_TRACE_LABEL || "Devil's advocate raised counterpoints and failure modes";
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
      { schemaName, maxOutputTokens: 2000 }
    );
    const counterpoints = out.counterpoints || [];
    const failureModes = out.failureModes || [];

    ctx.trace.addStep({
      type: 'challenge',
      description: traceLabel,
      output: { counterpoints, failureModes, confidence: out.confidence ?? null },
    });

    return { counterpoints, failureModes, confidence: out.confidence };
  },
};
