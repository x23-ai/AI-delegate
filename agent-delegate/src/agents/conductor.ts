import type { ConductorPlan } from './types.js';
import type { AgentContext } from './types.js';
import type { LLMClient } from '../llm/index.js';
import { loadRolePrompt } from '../utils/roles.js';
import { PlannerNavigator } from './planner.js';
import { FactSleuth } from './factChecker.js';
import { CogitoSage } from './reasoner.js';
import { RedTeamRaven } from './devilsAdvocate.js';
import { ArbiterSolon } from './judge.js';
import { log } from '../utils/logger.js';

// LLM prompts (editable)
const CONDUCTOR_PLANNING_QA_PROMPT =
  'You are planning QA. Evaluate if objectives and tasks are sufficient to assess a governance proposal. Return JSON { satisfied: boolean, missing: string[] }';

/**
 * Conductor orchestrates the multi-agent workflow. It does not hold policy
 * itself; instead it sequences specialist agents and records steps into the
 * ReasoningTrace via the shared TraceBuilder in the context.
 */
export async function runConductor(
  ctx: AgentContext,
  llmParam?: LLMClient
): Promise<ConductorPlan> {
  const llm = llmParam || ctx.llm;
  const conductorRole = loadRolePrompt('src/agents/roles/conductor.md');
  const sys = (s: string) => `${conductorRole}\n\n${s}`;
  const maxIters = Number(process.env.ORCH_MAX_ITERS || 2);
  // Note: only planning maintains a QA pass; other stages run once.

  // 1) Planning loop
  const totalPhases = 5;
  log.banner('PLANNING', 'Agent: Navigator Cartographer — drafting objectives & tasks');
  log.info(`[1/${totalPhases}] Conductor: handoff to Planner — define objectives and ordered tasks to evaluate the proposal`);
  let planning = await PlannerNavigator.run(ctx);
  // Pretty print plan overview
  try {
    const flow = (planning.tasks || []).join(' → ');
    const obj = (planning.objectives || []).map((o) => `- ${o}`).join('\n');
    log.info(
      'Plan overview:\n' +
        (obj ? `Objectives:\n${obj}\n` : '') +
        (flow ? `Tasks flow: ${flow}` : '')
    );
  } catch {}
  for (let i = 0; i < maxIters; i++) {
    if (!llm) break;
    log.info(`Conductor: planning QA iteration ${i + 1}`);
    const evalPlan = await llm.extractJSON<{ satisfied: boolean; missing: string[] }>(
      sys(CONDUCTOR_PLANNING_QA_PROMPT),
      `Objectives: ${JSON.stringify(planning.objectives)}\nTasks: ${JSON.stringify(planning.tasks)}`,
      {
        type: 'object',
        properties: {
          satisfied: { type: 'boolean' },
          missing: { type: 'array', items: { type: 'string' } },
        },
        required: ['satisfied', 'missing'],
      },
      { schemaName: 'planningQA', maxOutputTokens: 4000, difficulty: 'normal' }
    );
    ctx.trace.addStep({
      type: 'planning',
      description: 'Planning QA check',
      input: planning,
      output: evalPlan,
    });
    try {
      const missing = (evalPlan.missing || []).join('; ') || '(none)';
      log.info(`Planning QA result: satisfied=${evalPlan.satisfied} missing=${missing}`);
    } catch {}
    if (evalPlan.satisfied) break;
    // Re-run planner to refine; label the refinement distinctly
    const prevSchema = process.env.PLANNER_SCHEMA_NAME;
    const prevLabel = process.env.PLANNER_TRACE_LABEL;
    process.env.PLANNER_SCHEMA_NAME = 'plannerPlanRefine';
    process.env.PLANNER_TRACE_LABEL = `Planner refined objectives and tasks (iter ${i + 2})`;
    try {
      planning = await PlannerNavigator.run(ctx);
    } finally {
      if (prevSchema === undefined) delete process.env.PLANNER_SCHEMA_NAME;
      else process.env.PLANNER_SCHEMA_NAME = prevSchema;
      if (prevLabel === undefined) delete process.env.PLANNER_TRACE_LABEL;
      else process.env.PLANNER_TRACE_LABEL = prevLabel;
    }
  }

  // Cache planning stage
  ctx.cache?.set('planning', planning);

  // 2) Fact checking (no QA loop)
  log.banner('FACT CHECK', "Agent: Veritas Sleuth — extract assumptions, search evidence, classify claims");
  log.info(`[2/${totalPhases}] Conductor: handoff to Fact Checker — building corpus and evaluating assumptions`);
  let facts = await FactSleuth.run(ctx);

  // Cache facts stage
  ctx.cache?.set('facts', facts);

  // 3) Reasoning (no QA loop)
  log.banner('REASONING', 'Agent: Cogito Sage — focus on top aspects, synthesize argument');
  log.info(`[3/${totalPhases}] Conductor: handoff to Reasoner — forming structured argument grounded in vetted facts`);
  let reasoning = await CogitoSage.run(ctx);

  // Cache reasoning stage
  ctx.cache?.set('reasoning', reasoning);

  // 4) Challenge (no QA loop)
  log.banner("CHALLENGE", "Agent: Red Team Raven — stress-test premises, surface counterpoints and failure modes");
  log.info(`[4/${totalPhases}] Conductor: handoff to Devil's Advocate — testing the reasoning for weaknesses`);
  let challenge = await RedTeamRaven.run(ctx);

  // Cache challenge stage
  ctx.cache?.set('challenge', challenge);

  // 5) Adjudication (no QA loop)
  log.banner('ADJUDICATION', 'Agent: Arbiter Solon — weigh all stages and recommend a vote');
  log.info(`[5/${totalPhases}] Conductor: handoff to Judge — final recommendation with confidence`);
  let adjudication = await ArbiterSolon.run(ctx);

  return { planning, facts, reasoning, challenge, adjudication };
}
