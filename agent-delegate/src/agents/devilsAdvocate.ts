import type { DevilsAdvocateAgent } from './types.js';
import type { ChallengeOutput } from '../types.js';
import { loadRolePrompt } from '../utils/roles.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';

// LLM prompts (editable)
const DEVILS_ADVOCATE_PROMPT_SYSTEM_SUFFIX =
  "Stress-test the current reasoning and surface substantive counterpoints and failure modes.";

export const RedTeamRaven: DevilsAdvocateAgent = {
  kind: 'devilsAdvocate',
  codename: "Red Team Raven",
  systemPromptPath: 'src/agents/roles/devils-advocate.md',
  async run(ctx): Promise<ChallengeOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const role = loadRolePrompt(RedTeamRaven.systemPromptPath);
    const reasoning: any = ctx.cache?.get('reasoning') || {};
    const facts: any = ctx.cache?.get('facts') || {};
    const input = { reasoning, facts };
    const out = await llm.extractJSON<ChallengeOutput>(
      `${role}\n\n${DEVILS_ADVOCATE_PROMPT_SYSTEM_SUFFIX}`,
      JSON.stringify(input).slice(0, 6000),
      {
        type: 'object',
        properties: {
          counterpoints: { type: 'array', items: { type: 'string' } },
          failureModes: { type: 'array', items: { type: 'string' } },
        },
        required: ['counterpoints'],
      },
      { schemaName: 'challengeOut', maxOutputTokens: 2000 }
    );
    const counterpoints = out.counterpoints || [];
    const failureModes = out.failureModes || [];

    ctx.trace.addStep({
      type: 'challenge',
      description: "Devil's advocate raised counterpoints and failure modes",
      output: { counterpoints, failureModes },
    });

    return { counterpoints, failureModes };
  },
};
