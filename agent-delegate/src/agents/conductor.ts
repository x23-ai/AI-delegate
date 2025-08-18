import type { ConductorPlan } from './types.js';
import type { AgentContext } from './types.js';
import type { LLMClient } from '../llm/index.js';
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
export async function runConductor(ctx: AgentContext, llm?: LLMClient): Promise<ConductorPlan> {
  const maxIters = Number(process.env.ORCH_MAX_ITERS || 2);
  const judgeThreshold = Number(process.env.JUDGE_CONFIDENCE || 0.5);

  // 1) Planning loop
  let planning = await PlannerNavigator.run(ctx);
  for (let i = 0; i < maxIters; i++) {
    if (!llm) break;
    const evalPlan = await llm.extractJSON<{ satisfied: boolean; missing: string[] }>(
      'You are planning QA. Evaluate if objectives and tasks are sufficient to assess a governance proposal. Return JSON { satisfied: boolean, missing: string[] }',
      `Objectives: ${JSON.stringify(planning.objectives)}\nTasks: ${JSON.stringify(planning.tasks)}`,
      {
        type: 'object',
        properties: {
          satisfied: { type: 'boolean' },
          missing: { type: 'array', items: { type: 'string' } },
        },
        required: ['satisfied', 'missing'],
      }
    );
    ctx.trace.addStep({ type: 'planning', description: 'Planning QA check', input: planning, output: evalPlan });
    if (evalPlan.satisfied) break;
    // Re-run planner to refine; in future pass feedback
    planning = await PlannerNavigator.run(ctx);
  }

  // 2) Fact checking loop
  let facts = await FactSleuth.run(ctx);
  for (let i = 0; i < maxIters; i++) {
    if (!llm) break;
    const evalFacts = await llm.extractJSON<{ satisfied: boolean; missingCitations: number }>(
      'You validate fact-check sets for coverage and citations. Return JSON { satisfied: boolean, missingCitations: number } where satisfied means there is sufficient evidence to proceed.',
      `Claims: ${JSON.stringify(facts.claims)}\nEvidence: ${JSON.stringify(facts.keyEvidence)}`,
      {
        type: 'object',
        properties: {
          satisfied: { type: 'boolean' },
          missingCitations: { type: 'number' },
        },
        required: ['satisfied', 'missingCitations'],
      }
    );
    ctx.trace.addStep({ type: 'factCheck', description: 'Fact QA check', input: facts, output: evalFacts });
    if (evalFacts.satisfied) break;
    facts = await FactSleuth.run(ctx);
  }

  // 3) Reasoning loop
  let reasoning = await CogitoSage.run(ctx);
  for (let i = 0; i < maxIters; i++) {
    if (!llm) break;
    const evalReason = await llm.extractJSON<{ coherent: boolean; gaps: string[] }>(
      'You are a reasoning QA. Assess coherence and identify gaps. Return JSON { coherent: boolean, gaps: string[] }',
      `Premises: ${JSON.stringify(reasoning.premises)}\nArgument: ${reasoning.argument}`,
      {
        type: 'object',
        properties: {
          coherent: { type: 'boolean' },
          gaps: { type: 'array', items: { type: 'string' } },
        },
        required: ['coherent', 'gaps'],
      }
    );
    ctx.trace.addStep({ type: 'reasoning', description: 'Reasoning QA check', input: reasoning, output: evalReason });
    if (evalReason.coherent) break;
    reasoning = await CogitoSage.run(ctx);
  }

  // 4) Challenge loop
  let challenge = await RedTeamRaven.run(ctx);
  for (let i = 0; i < maxIters; i++) {
    if (!llm) break;
    const evalChallenge = await llm.extractJSON<{ robust: boolean; missingRisks: number }>(
      'You are a red-team QA. Ensure counterpoints/failure modes are substantive. Return JSON { robust: boolean, missingRisks: number }.',
      `Counterpoints: ${JSON.stringify(challenge.counterpoints)}\nFailureModes: ${JSON.stringify(challenge.failureModes)}`,
      {
        type: 'object',
        properties: {
          robust: { type: 'boolean' },
          missingRisks: { type: 'number' },
        },
        required: ['robust', 'missingRisks'],
      }
    );
    ctx.trace.addStep({ type: 'challenge', description: 'Challenge QA check', input: challenge, output: evalChallenge });
    if (evalChallenge.robust) break;
    challenge = await RedTeamRaven.run(ctx);
  }

  // 5) Adjudication loop
  let adjudication = await ArbiterSolon.run(ctx);
  for (let i = 0; i < maxIters; i++) {
    if (!llm) break;
    const evalJudge = await llm.extractJSON<{ accept: boolean; confidence: number }>(
      'You evaluate if a recommendation is justified. Return JSON { accept: boolean, confidence: number } with confidence 0..1.',
      `Recommendation: ${adjudication.recommendation}\nRationale: ${adjudication.rationale}`,
      {
        type: 'object',
        properties: {
          accept: { type: 'boolean' },
          confidence: { type: 'number' },
        },
        required: ['accept', 'confidence'],
      }
    );
    ctx.trace.addStep({ type: 'adjudication', description: 'Judge QA check', input: adjudication, output: evalJudge });
    if (evalJudge.accept && evalJudge.confidence >= judgeThreshold) break;
    adjudication = await ArbiterSolon.run(ctx);
  }

  return { planning, facts, reasoning, challenge, adjudication };
}
