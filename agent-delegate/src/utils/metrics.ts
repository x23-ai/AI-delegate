export type MetricsSummary = {
  llmCalls: number;
  llmInputTokens: number; // may include estimates
  llmOutputTokens: number; // may include estimates
  x23Calls: number;
  docsEvaluated: number;
};

class MetricsCollector {
  private _llmCalls = 0;
  private _llmIn = 0;
  private _llmOut = 0;
  private _x23Calls = 0;
  private _docs = 0;

  incrementLLMCalls(): void {
    this._llmCalls += 1;
  }
  recordLLMUsage(inputTokens: number | undefined, outputTokens: number | undefined): void {
    this._llmCalls += 1;
    if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) this._llmIn += inputTokens;
    if (typeof outputTokens === 'number' && Number.isFinite(outputTokens)) this._llmOut += outputTokens;
  }
  incrementX23Calls(): void {
    this._x23Calls += 1;
  }
  addDocs(n: number): void {
    if (typeof n === 'number' && n > 0) this._docs += n;
  }
  summary(): MetricsSummary {
    return {
      llmCalls: this._llmCalls,
      llmInputTokens: this._llmIn,
      llmOutputTokens: this._llmOut,
      x23Calls: this._x23Calls,
      docsEvaluated: this._docs,
    };
  }
  reset(): void {
    this._llmCalls = 0;
    this._llmIn = 0;
    this._llmOut = 0;
    this._x23Calls = 0;
    this._docs = 0;
  }
}

export const metrics = new MetricsCollector();

