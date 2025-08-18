import type { ReasonerAgent } from './types.js';
import type { ReasoningOutput } from '../types.js';

export const CogitoSage: ReasonerAgent = {
  kind: 'reasoner',
  codename: 'Cogito Sage',
  systemPromptPath: 'src/agents/roles/reasoner.md',
  async run(ctx): Promise<ReasoningOutput> {
    // Scaffold: stitch together a minimal argument
    const premises = [
      'Proposal impact is material to stakeholders',
      'Evidence gathered is sufficient and timely',
    ];
    const argument = 'Preliminary synthesis based on collected sources and planner objectives.';

    ctx.trace.addStep({
      type: 'reasoning',
      description: 'Reasoner drafted preliminary argument with premises',
      output: { premises, outline: argument },
    });

    return { argument, premises, uncertainties: [] };
  },
};

