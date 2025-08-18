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
export async function runConductor(ctx: AgentContext, llmParam?: LLMClient): Promise<ConductorPlan> {
  const llm = llmParam || ctx.llm;
  const maxIters = Number(process.env.ORCH_MAX_ITERS || 2);
  const judgeThreshold = Number(process.env.JUDGE_CONFIDENCE || 0.5);

  async function scoreStage(stage: string, content: unknown): Promise<number | undefined> {
    if (!llm) return undefined;
    const res = await llm.extractJSON<{ confidence: number; notes?: string }>(
      `You rate the ${stage} stage quality on a 0..1 scale. Consider completeness, clarity, and adequacy for downstream judgment. Return JSON { confidence:number, notes?:string }`,
      JSON.stringify(content).slice(0, 6000),
      {
        type: 'object',
        properties: { confidence: { type: 'number' }, notes: { type: 'string' } },
        required: ['confidence'],
      },
      { schemaName: `${stage}Score` }
    );
    ctx.trace.addStep({ type: 'analysis', description: `${stage} confidence scored`, input: content, output: res });
    return res.confidence;
  }

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

  // Score planning stage
  planning.confidence = (await scoreStage('planning', planning)) ?? planning.confidence;
  ctx.cache?.set('planning', planning);

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

  // Score facts stage (use provided overall if present)
  facts.overallConfidence = facts.overallConfidence ?? (await scoreStage('factCheck', facts)) ?? facts.overallConfidence;
  ctx.cache?.set('facts', facts);

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

  // Score reasoning stage
  reasoning.confidence = (await scoreStage('reasoning', reasoning)) ?? reasoning.confidence;
  ctx.cache?.set('reasoning', reasoning);

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

  // Score challenge stage
  challenge.confidence = (await scoreStage('challenge', challenge)) ?? challenge.confidence;
  ctx.cache?.set('challenge', challenge);

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
