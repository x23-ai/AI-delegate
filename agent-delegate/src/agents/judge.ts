import type { JudgeAgent } from './types.js';
import type { AdjudicationOutput } from '../types.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import { loadRolePrompt } from '../utils/roles.js';

// LLM prompts (editable)
const JUDGE_PROMPT_SYSTEM_SUFFIX = [
  'You are the final judge. Consider each stage output and its confidence.',
  '- Incorporate the Goals section from your role when weighing tradeoffs. Make explicit how the decision aligns or conflicts with those goals.',
  '- Rationale: describe your internal thought process, explicitly weighing pros and cons based on Planner, FactChecker, Reasoner, and Devil’s Advocate conclusions. Be transparent about tradeoffs and key uncertainties.',
  "- Reason: a concise, publication-ready explanation of the vote for onchain posting (no more than 2-3 sentences).",
  'Produce JSON with recommendation, rationale, reason, and confidence (0..1).',
].join('\n');

export const ArbiterSolon: JudgeAgent = {
  kind: 'judge',
  codename: 'Arbiter Solon',
  systemPromptPath: 'src/agents/roles/judge.md',
  async run(ctx): Promise<AdjudicationOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const role = loadRolePrompt(ArbiterSolon.systemPromptPath);
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

    const schemaName = process.env.JUDGE_SCHEMA_NAME || 'judgment';
    const traceLabel =
      process.env.JUDGE_TRACE_LABEL || 'Judge produced recommendation with confidence';
    const result = await llm.extractJSON<{
      recommendation: 'for' | 'against' | 'abstain';
      rationale: string;
      reason: string;
      confidence: number;
    }>(
      `${role}\n\n${JUDGE_PROMPT_SYSTEM_SUFFIX}`,
      JSON.stringify(inputSummary).slice(0, 6000),
      {
        type: 'object',
        properties: {
          recommendation: { type: 'string', enum: ['for', 'against', 'abstain'] },
          rationale: { type: 'string' },
          reason: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['recommendation', 'rationale', 'reason', 'confidence'],
      },
      { schemaName, maxOutputTokens: 3000, difficulty: 'hard' }
    );

    ctx.trace.addStep({
      type: 'adjudication',
      description: traceLabel,
      output: result,
    });

    return {
      recommendation: result.recommendation,
      rationale: result.rationale,
      reason: result.reason,
      confidence: result.confidence,
    };
  },
};
