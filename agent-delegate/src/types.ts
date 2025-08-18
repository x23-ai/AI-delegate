export type StepType =
  | 'fetchOnchain'
  | 'fetchOffchain'
  | 'fetchForum'
  | 'fetchGitHub'
  | 'analysis'
  | 'toolCall'
  | 'decision'
  // Multi-agent orchestration steps
  | 'planning'
  | 'factCheck'
  | 'reasoning'
  | 'challenge'
  | 'adjudication';

export interface Reference {
  source: 'IPFS' | 'Ethereum' | 'Snapshot' | 'Forum' | 'GitHub' | string;
  uri: string;
}

export interface ReasoningStep {
  id: string;
  timestamp: string; // ISO 8601
  type: StepType;
  description: string;
  input?: any;
  output?: any;
  references?: Reference[];
}

export interface ReasoningTrace {
  proposalId: number;
  agentId: string;
  createdAt: string;
  steps: ReasoningStep[];
}

// Agent orchestration scaffolding
export type VoteSupport = 'for' | 'against' | 'abstain' | 'defer';

export interface ProposalInput {
  // Identifiers and seed context the conductor will ingest
  id: number;
  title?: string;
  description?: string;
  // Optional URIs for forums, specs, snapshots, repos, etc.
  sources?: string[];
}

export interface PlanningOutput {
  objectives: string[];
  tasks: string[]; // ordered, high-level steps
  assumptions?: string[];
  risks?: string[];
  confidence?: number;
}

export interface FactCheckOutput {
  claims: Array<{ claim: string; status: 'supported' | 'contested' | 'unknown'; citations: string[]; confidence?: number }>;
  keyEvidence: string[]; // URIs or summarized snippets
  overallConfidence?: number; // 0..1 aggregate confidence
}

export interface ReasoningOutput {
  argument: string; // structured narrative or bullet reasoning
  premises: string[];
  uncertainties?: string[];
  confidence?: number;
}

export interface ChallengeOutput {
  counterpoints: string[];
  failureModes?: string[];
  confidence?: number;
}

export interface AdjudicationOutput {
  recommendation: VoteSupport;
  rationale: string;
  confidence?: number;
}

export interface ConductorResult {
  planning: PlanningOutput;
  facts: FactCheckOutput;
  reasoning: ReasoningOutput;
  challenge: ChallengeOutput;
  adjudication: AdjudicationOutput;
}
