import type {
  PlanningOutput,
  FactCheckOutput,
  ReasoningOutput,
  ChallengeOutput,
  AdjudicationOutput,
  ProposalInput,
  VoteSupport,
} from '../types.js';
import { TraceBuilder } from '../trace.js';
import { X23Client } from '../tools/x23.js';

export type AgentKind =
  | 'conductor'
  | 'planner'
  | 'factChecker'
  | 'reasoner'
  | 'devilsAdvocate'
  | 'judge';

export interface AgentContext {
  proposal: ProposalInput;
  x23: X23Client;
  trace: TraceBuilder;
  // space for other shared state (snapshots, temp caches, etc.)
  cache?: Map<string, unknown>;
}

export interface Agent<TOutput> {
  kind: AgentKind;
  codename: string; // cool/interesting name per role
  systemPromptPath: string; // path to role prompt file
  run(ctx: AgentContext): Promise<TOutput>;
}

export interface ConductorPlan {
  planning: PlanningOutput;
  facts: FactCheckOutput;
  reasoning: ReasoningOutput;
  challenge: ChallengeOutput;
  adjudication: AdjudicationOutput;
}

export type PlannerAgent = Agent<PlanningOutput>;
export type FactCheckerAgent = Agent<FactCheckOutput>;
export type ReasonerAgent = Agent<ReasoningOutput>;
export type DevilsAdvocateAgent = Agent<ChallengeOutput>;
export type JudgeAgent = Agent<AdjudicationOutput>;

