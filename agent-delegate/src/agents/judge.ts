import type { JudgeAgent } from './types.js';
import type { AdjudicationOutput } from '../types.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';

export const ArbiterSolon: JudgeAgent = {
  kind: 'judge',
  codename: 'Arbiter Solon',
  systemPromptPath: 'src/agents/roles/judge.md',
  async run(ctx): Promise<AdjudicationOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const planning = ctx.cache?.get('planning') ?? null;
    const facts = ctx.cache?.get('facts') ?? null;
    const reasoning = ctx.cache?.get('reasoning') ?? null;
    const challenge = ctx.cache?.get('challenge') ?? null;

    const inputSummary = {
      planning,
      facts,
      reasoning,
      challenge,
    };

    const result = await llm.extractJSON<{
      recommendation: 'for' | 'against' | 'abstain' | 'defer';
      rationale: string;
      confidence: number;
    }>(
      'You are the final judge. Consider each stage output and its confidence. Produce a recommendation with rationale and confidence (0..1).',
      JSON.stringify(inputSummary).slice(0, 6000),
      {
        type: 'object',
        properties: {
          recommendation: { type: 'string', enum: ['for', 'against', 'abstain', 'defer'] },
          rationale: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['recommendation', 'rationale', 'confidence'],
      },
      { schemaName: 'judgment' }
    );

    ctx.trace.addStep({
      type: 'adjudication',
      description: 'Judge produced recommendation with confidence',
      output: result,
    });

    return { recommendation: result.recommendation, rationale: result.rationale, confidence: result.confidence };
  },
};
