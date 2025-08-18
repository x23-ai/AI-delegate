import type { DevilsAdvocateAgent } from './types.js';
import type { ChallengeOutput } from '../types.js';

export const RedTeamRaven: DevilsAdvocateAgent = {
  kind: 'devilsAdvocate',
  codename: "Red Team Raven",
  systemPromptPath: 'src/agents/roles/devils-advocate.md',
  async run(ctx): Promise<ChallengeOutput> {
    const counterpoints = [
      'Insufficient consideration of edge-case risks',
      'Potential conflicts with precedent or policy',
    ];
    const failureModes = [
      'Unintended economic incentives',
      'Operational complexity and governance overhead',
    ];

    ctx.trace.addStep({
      type: 'challenge',
      description: "Devil's advocate raised counterpoints and failure modes",
      output: { counterpoints, failureModes },
    });

    return { counterpoints, failureModes };
  },
};

