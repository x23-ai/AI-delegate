import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });
import { TraceBuilder } from './trace.js';
import { X23Client } from './tools/x23.js';
import { AlchemyPricesClient } from './tools/prices.js';
import { CuratedSourceQAClient } from './tools/curated.js';
import { runConductor } from './agents/conductor.js';
import { createLLM } from './llm/index.js';
import type { AgentContext } from './agents/types.js';
import { loadProposalParams, getCliArgs } from './utils/config.js';
import { validateConfig } from './utils/configValidate.js';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { log } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

async function main() {
  // Validate configuration early for clearer errors
  validateConfig();
  const proposal = loadProposalParams();
  const proposalId = proposal.id;
  const agentId = process.env.AGENT_ID || 'conductor-1';

  const trace = new TraceBuilder(proposalId, agentId);
  const x23 = new X23Client({ apiKey: process.env.X23_API_KEY });
  const prices = new AlchemyPricesClient();
  const curatedQA = new CuratedSourceQAClient(x23);
  const llm = createLLM();

  const ctx: AgentContext = {
    proposal,
    x23,
    prices,
    curatedQA,
    trace,
    cache: new Map(),
    llm,
  };

  log.banner('ORCHESTRATION START', `Proposal ${proposalId}: ${proposal.title || 'untitled'}`);
  log.info('Orchestrator: initializing agents and tools');
  const result = await runConductor(ctx, llm);
  log.info('Orchestrator: run complete');
  console.log('Conductor pipeline result:', JSON.stringify(result, null, 2));

  // Compact summary of stage confidences and outcomes
  const fc = result.facts;
  const counts = fc.claims.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    { supported: 0, contested: 0, unknown: 0 } as Record<string, number>
  );
  const summaryLines = [
    '--- Summary ---',
    `Planning confidence: ${result.planning.confidence ?? 'n/a'}`,
    `Facts confidence:    ${result.facts.overallConfidence ?? 'n/a'} (supported:${counts.supported} contested:${counts.contested} unknown:${counts.unknown})`,
    `Reasoning confidence:${result.reasoning.confidence ?? 'n/a'}`,
    `Challenge confidence:${result.challenge.confidence ?? 'n/a'}`,
    `Judge: ${result.adjudication.recommendation.toUpperCase()} (confidence: ${result.adjudication.confidence ?? 'n/a'})`,
  ];
  console.log(summaryLines.join('\n'));

  // Metrics summary
  try {
    const m = metrics.summary();
    const metricsLines = [
      '--- Usage Metrics ---',
      `LLM tokens: input=${m.llmInputTokens} output=${m.llmOutputTokens} (calls=${m.llmCalls})`,
      `x23 API calls: ${m.x23Calls}`,
      `Docs/sources evaluated: ${m.docsEvaluated}`,
    ];
    console.log(metricsLines.join('\n'));
  } catch {}

  // Optional: write summary to JSON when --summary-json path is provided
  const args = getCliArgs();
  const summaryPath = args['summary-json'] || args['summary'];
  if (summaryPath) {
    const summaryObj = {
      planningConfidence: result.planning.confidence ?? null,
      factsConfidence: result.facts.overallConfidence ?? null,
      counts,
      reasoningConfidence: result.reasoning.confidence ?? null,
      challengeConfidence: result.challenge.confidence ?? null,
      judge: {
        recommendation: result.adjudication.recommendation,
        confidence: result.adjudication.confidence ?? null,
      },
    };
    const p = resolve(summaryPath);
    writeFileSync(p, JSON.stringify(summaryObj, null, 2));
    console.log(`Summary written to ${p}`);
  }

  // Optional: save full reasoning trace to JSON when env enabled
  const saveTraceFlag = String(process.env.SAVE_TRACE_JSON || '').toLowerCase();
  const shouldSaveTrace =
    saveTraceFlag === '1' || saveTraceFlag === 'true' || saveTraceFlag === 'yes';
  if (shouldSaveTrace) {
    const defaultName = `results/trace-proposal-${proposalId}-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;
    const outPath = resolve(process.env.TRACE_JSON_PATH || defaultName);
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(trace.getTrace(), null, 2));
      log.info(`Reasoning trace saved to ${outPath}`);
    } catch (e) {
      log.error('Failed to save reasoning trace JSON', e);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
