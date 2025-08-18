import type { ConductorPlan } from './types.js';
import type { AgentContext } from './types.js';
import { PlannerNavigator } from './planner.js';
import { FactSleuth } from './factChecker.js';
import { CogitoSage } from './reasoner.js';
import { RedTeamRaven } from './devilsAdvocate.js';
import { ArbiterSolon } from './judge.js';

/**
 * Conductor orchestrates the multi-agent workflow. It does not hold policy
 * itself; instead it sequences specialist agents and records steps into the
 * ReasoningTrace via the shared TraceBuilder in the context.
 */
export async function runConductor(ctx: AgentContext): Promise<ConductorPlan> {
  // Planner defines objectives and tasks
  const planning = await PlannerNavigator.run(ctx);

  // Fact checker collects sources and validates claims
  const facts = await FactSleuth.run(ctx);

  // Reasoner synthesizes arguments from facts
  const reasoning = await CogitoSage.run(ctx);

  // Devil's advocate challenges assumptions and highlights risks
  const challenge = await RedTeamRaven.run(ctx);

  // Judge makes a recommendation and rationale
  const adjudication = await ArbiterSolon.run(ctx);

  return { planning, facts, reasoning, challenge, adjudication };
}

