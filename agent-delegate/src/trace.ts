import { v4 as uuidv4 } from 'uuid';
import type { ReasoningStep, ReasoningTrace } from './types.js';

export class TraceBuilder {
  private trace: ReasoningTrace;

  constructor(proposalId: number, agentId: string) {
    this.trace = {
      proposalId,
      agentId,
      createdAt: new Date().toISOString(),
      steps: [],
    };
  }

  addStep(params: Omit<ReasoningStep, 'id' | 'timestamp'>) {
    const step: ReasoningStep = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...params,
    };
    this.trace.steps.push(step);
    return step.id;
  }

  getTrace(): ReasoningTrace {
    return this.trace;
  }
}
