import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { PlannerAgent } from './types.js';
import type { PlanningOutput } from '../types.js';

export const PlannerNavigator: PlannerAgent = {
  kind: 'planner',
  codename: 'Navigator Cartographer',
  systemPromptPath: resolve('src/agents/roles/planner.md'),
  async run(ctx): Promise<PlanningOutput> {
    // Scaffold: design a minimal plan for the pipeline
    const objectives = [
      'Identify proposal scope, stakeholders, and decision surface',
      'Collect official specs, forum discussions, and prior votes',
      'Extract claims and data points to verify',
      'Synthesize arguments with trade-offs and risks',
    ];
    const tasks = [
      'Seed sources → hybrid search (official-first)',
      'Build timeline of key events',
      'Extract claim list for fact checking',
      'Assemble pro/con reasoning draft',
    ];

    const refs = (ctx.proposal.payload || [])
      .filter((p) => !!p.uri)
      .slice(0, 5)
      .map((p) => ({ source: p.type || 'payload', uri: p.uri! }));
    ctx.trace.addStep({
      type: 'planning',
      description: 'Planner created initial objectives and tasks',
      output: { objectives, tasks },
      references: refs,
    });

    return { objectives, tasks, assumptions: [], risks: [] };
  },
};
