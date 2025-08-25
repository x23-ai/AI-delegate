/**
 * Curated Source QA tool
 *
 * Wraps a crawl-and-answer endpoint that answers a question from a specific URL.
 * The URL is chosen from a curated catalog with explicit scopes.
 *
 * Implementation uses x23 evaluateOfficialUrl to answer from the exact URL.
 */

import { CURATED_SOURCES, getCuratedSourceById, type CuratedSource } from './curatedCatalog.js';
import { log, colors } from '../utils/logger.js';
import { X23Client } from './x23.js';
import { AVAILABLE_PROTOCOLS } from '../utils/x23Config.js';

export type CuratedAnswer = {
  answer?: string;
  usedUrl?: string;
  citations?: Array<{ url: string; snippet?: string; title?: string }>;
  confidence?: number; // 0..1 if provided by backend
  raw?: any;
};

export class CuratedSourceQAClient {
  private x23: X23Client;
  constructor(x23: X23Client) {
    this.x23 = x23;
  }

  isConfigured(): boolean {
    return Boolean(this.x23);
  }

  listSources(): CuratedSource[] {
    return CURATED_SOURCES;
  }

  async answerFromSource(params: { sourceId: string; question: string }): Promise<CuratedAnswer> {
    const { sourceId } = params;
    const question = (params.question || '').slice(0, 512);
    const src = getCuratedSourceById(sourceId);
    if (!src) throw new Error(`Unknown curated source: ${sourceId}`);
    const spinner = log.spinner(`Curated QA (x23 evaluateOfficialUrl): ${sourceId}`);
    const start = Date.now();
    try {
      const res = await this.x23.evaluateOfficialUrl({
        protocol: AVAILABLE_PROTOCOLS[0] || 'optimism',
        url: src.url,
        question,
      });
      const ms = Date.now() - start;
      spinner.stop(`${colors.green('✓')} Curated QA evaluated ${colors.dim(`(${ms}ms)`)}`);
      const answer: CuratedAnswer = {
        answer: res.answer,
        usedUrl: src.url,
        confidence: undefined,
        citations: (res.citations || []).map((d) => ({ url: d.uri || d.title || src.url, snippet: d.snippet, title: d.title })),
        raw: res,
      };
      return answer;
    } catch (e) {
      try {
        spinner.stop(`${colors.red('✗')} Curated QA realtime`);
      } catch {}
      throw e;
    }
  }
}
