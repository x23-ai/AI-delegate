export type StepType =
  | 'fetchOnchain'
  | 'fetchOffchain'
  | 'fetchForum'
  | 'fetchGitHub'
  | 'analysis'
  | 'toolCall'
  | 'decision';

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
