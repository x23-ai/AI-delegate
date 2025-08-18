import type { JudgeAgent } from './types.js';
import type { AdjudicationOutput } from '../types.js';

export const ArbiterSolon: JudgeAgent = {
  kind: 'judge',
  codename: 'Arbiter Solon',
  systemPromptPath: 'src/agents/roles/judge.md',
  async run(ctx): Promise<AdjudicationOutput> {
    // Scaffold: neutral default until policy is defined
    const recommendation: AdjudicationOutput['recommendation'] = 'defer';
    const rationale = 'Awaiting full policy criteria and confidence thresholds.';

    ctx.trace.addStep({
      type: 'adjudication',
      description: 'Judge produced a preliminary recommendation and rationale',
      output: { recommendation, rationale },
    });

    return { recommendation, rationale };
  },
};

