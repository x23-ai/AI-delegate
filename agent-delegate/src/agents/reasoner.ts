import type { ReasonerAgent } from './types.js';
import type { ReasoningOutput } from '../types.js';
import { loadRolePrompt } from '../utils/roles.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';

// LLM prompts (editable)
const REASONER_PROMPT_SYSTEM_SUFFIX =
  'Form structured reasoning for the proposal, grounded in the vetted facts and planning objectives. Be explicit about uncertainties.';

export const CogitoSage: ReasonerAgent = {
  kind: 'reasoner',
  codename: 'Cogito Sage',
  systemPromptPath: 'src/agents/roles/reasoner.md',
  async run(ctx): Promise<ReasoningOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const role = loadRolePrompt(CogitoSage.systemPromptPath);
    const facts: any = ctx.cache?.get('facts') || {};
    const planning: any = ctx.cache?.get('planning') || {};
    const input = {
      proposal: { id: ctx.proposal.id, title: ctx.proposal.title, description: ctx.proposal.description },
      planning,
      facts,
    };
    const out = await llm.extractJSON<ReasoningOutput>(
      `${role}\n\n${REASONER_PROMPT_SYSTEM_SUFFIX}`,
      JSON.stringify(input).slice(0, 6000),
      {
        type: 'object',
        properties: {
          argument: { type: 'string' },
          premises: { type: 'array', items: { type: 'string' } },
          uncertainties: { type: 'array', items: { type: 'string' } },
        },
        required: ['argument', 'premises'],
      },
      { schemaName: 'reasoningOut', maxOutputTokens: 3000 }
    );
    const premises = out.premises || [];
    const argument = out.argument || '';

    ctx.trace.addStep({
      type: 'reasoning',
      description: 'Reasoner drafted preliminary argument with premises',
      output: { premises, outline: argument },
    });

    return { argument, premises, uncertainties: out.uncertainties || [] };
  },
};
