export const SchemaNames = {
  planner: () => process.env.PLANNER_SCHEMA_NAME || 'plannerPlan',
  factChecker: () => process.env.FACT_SCHEMA_NAME || 'factCheck',
  reasoning: () => process.env.REASONER_SCHEMA_NAME || 'reasoningOut',
  reasoningRefined: () => 'reasoningOutRefined',
  devils: () => process.env.DEVILS_SCHEMA_NAME || 'challengeOut',
  judge: () => process.env.JUDGE_SCHEMA_NAME || 'judgment',
} as const;

export const TraceLabels = {
  planner: () => process.env.PLANNER_TRACE_LABEL || 'Planner produced objectives and tasks',
  factChecker: () => process.env.FACT_TRACE_LABEL || 'FactChecker evaluated assumptions and arithmetic',
  reasoning: () => process.env.REASONER_TRACE_LABEL || 'Reasoner drafted preliminary argument with premises',
  reasoningRefined: (iter?: number) =>
    iter ? `Refined reasoning with evidence context (iter ${iter})` : 'Refined reasoning with evidence context',
  devils: () => process.env.DEVILS_TRACE_LABEL || "Devil's advocate raised counterpoints and failure modes",
  judge: () => process.env.JUDGE_TRACE_LABEL || 'Judge produced recommendation with confidence',
} as const;

