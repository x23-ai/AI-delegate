/**
 * x23.ai API tool scaffolding
 *
 * These interfaces wrap search and retrieval capabilities used by agents.
 * Implementations should call https://api.x23.ai/ endpoints and map results
 * into these types. Until wired, stubs return empty results.
 */

export interface X23Config {
  apiKey?: string; // X23_API_KEY
  baseUrl?: string; // defaults to https://api.x23.ai/v1
  // Optional safety knobs, rate-limits, etc.
  timeoutMs?: number;
}

export interface SearchQuery {
  query: string;
  filters?: Record<string, string | number | boolean>;
  topK?: number;
}

export interface DocChunk {
  id: string;
  title?: string;
  uri?: string;
  publishedAt?: string;
  source?: string; // forum, snapshot, github, spec, etc.
  snippet?: string;
  score?: number;
}

export interface AnswerSynthesis {
  answer: string;
  citations: DocChunk[];
  citationsRaw?: any[]; // raw items as returned by API for spec-compliant follow-ups (e.g., timeline)
  freshnessNote?: string; // reflects real-time context
}

export interface DiscussionPost {
  id: string;
  author?: string;
  createdAt?: string;
  body: string;
  uri?: string;
}

export interface TimelineItem {
  id: string;
  label: string;
  timestamp: string;
  uri?: string;
  meta?: Record<string, unknown>;
}

import { log, colors } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

function getDebugLevel(): number {
  const d = String(process.env.DEBUG || '').trim().toLowerCase();
  if (d === '1' || d === 'true' || d === 'yes') return 1;
  const lvl = Number(process.env.DEBUG_LEVEL || '0');
  return Number.isFinite(lvl) ? Math.max(0, Math.min(3, lvl)) : 0;
}
const DEBUG_LEVEL = getDebugLevel();

const DEBUG = (() => {
  const v = String(process.env.DEBUG || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
})();

export class X23Client {
  private config: X23Config;
  constructor(config: X23Config = {}) {
    this.config = { baseUrl: 'https://api.x23.ai/v1', timeoutMs: 20000, ...config };
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const start = Date.now();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;
    const method = (init?.method || 'GET').toUpperCase();
    // Do not log request bodies at info level
    log.info(`${colors.cyan('x23 request')} → ${method} ${path}`);
    // Optionally emit request body at debug level
    if (DEBUG_LEVEL >= 2) {
      try {
        const b = (init as any)?.body;
        const bodyPreview = typeof b === 'string' ? b : b ? JSON.stringify(b) : undefined;
        if (bodyPreview) log.debug('x23 request body', { method, path, body: bodyPreview });
      } catch {}
    }
    const spinner = log.spinner(`x23 ${method} ${path}`);
    try {
      metrics.incrementX23Calls();
      const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as any) } });
      const ms = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        spinner.stop(`${colors.red('✗')} x23 ${method} ${path} ${colors.dim(`(${ms}ms)`)}`);
        log.error(`${colors.cyan('x23 response')} ${colors.red('✗')} ${method} ${path} ${colors.dim(`(${ms}ms)`)} ${colors.red(String(res.status))}`);
        throw new Error(`x23 ${path} ${res.status} (${ms}ms): ${text}`);
      }
      spinner.stop();
      const json = (await res.json()) as T;
      if (DEBUG_LEVEL >= 1) {
        try {
          log.debug('x23 raw response', { method, path, ms, json });
        } catch {}
      }
      return json;
    } finally {
      // Ensure spinner is stopped if not already (no message)
      try { spinner.stop(); } catch {}
    }
  }

  private toIso(unix?: number | string): string | undefined {
    const n = typeof unix === 'number' ? unix : typeof unix === 'string' ? Number(unix) : NaN;
    if (!Number.isFinite(n)) return undefined;
    return new Date(n * 1000).toISOString();
  }

  private mapItemToDocChunk(item: any): DocChunk {
    const uri = item.sourceUrl || item.appUrl || undefined;
    const publishedAt = this.toIso(item.updated ?? item.created ?? item.firstSeen);
    const title = item.title || item.id?.toString();
    const snippet = item.tldr || item.headline || item.digest;
    const source = item.type || item.protocol;
    const id = String(item.id ?? item.sha ?? item.title ?? Math.random());
    return { id, title, uri, publishedAt, source, snippet, score: item.score };
  }

  /** Get supported protocols and item types. */
  async supportedProtocols(): Promise<{ name: string; formattedName?: string; supportedItemTypes?: string[] }[]> {
    type Resp = { status: string; result: { protocols: any[] } };
    const data = await this.req<Resp>('/supportedProtocols', { method: 'GET' });
    return data.result?.protocols ?? [];
  }

  async supportedItemTypes(): Promise<string[]> {
    type Resp = { status: string; result: { itemTypes: string[] } };
    const data = await this.req<Resp>('/supportedItemTypes', { method: 'GET' });
    return data.result?.itemTypes ?? [];
  }

  /** Keyword-only search across indexed sources. (raw + mapped) */
  async keywordSearchRaw(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; limit?: number; sortByRelevance?: boolean }): Promise<{ raw: any; doc: DocChunk }[]> {
    type Resp = { status: string; result: { results: any[] } };
    const body = {
      query: q.query,
      sortByRelevance: q['sortByRelevance'] ?? true,
      protocols: q['protocols'] ?? [],
      itemTypes: q['itemTypes'] ?? [],
      limit: q.topK ?? q['limit'] ?? 20,
    };
    const data = await this.req<Resp>('/keywordSearch', { method: 'POST', body: JSON.stringify(body) });
    const results = data.result?.results ?? [];
    const pairs = results.map((it) => ({ raw: it, doc: this.mapItemToDocChunk(it) }));
    log.info(`x23 keywordSearch: ${pairs.length} docs`);
    metrics.addDocs(pairs.length);
    return pairs;
  }

  async keywordSearch(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; limit?: number; sortByRelevance?: boolean }): Promise<DocChunk[]> {
    const pairs = await this.keywordSearchRaw(q);
    return pairs.map((p) => p.doc);
  }

  /** Vector/RAG semantic search. (raw + mapped) */
  async vectorSearchRaw(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; similarityThreshold?: number; limit?: number }): Promise<{ raw: any; doc: DocChunk }[]> {
    type Resp = { status: string; result: { results: any[] } };
    const body = {
      query: q.query,
      similarityThreshold: q['similarityThreshold'] ?? 0.4,
      protocols: q['protocols'] ?? [],
      itemTypes: q['itemTypes'] ?? [],
      limit: q.topK ?? q['limit'] ?? 5,
    };
    const data = await this.req<Resp>('/ragSearch', { method: 'POST', body: JSON.stringify(body) });
    const results = data.result?.results ?? [];
    const pairs = results.map((it) => ({ raw: it, doc: this.mapItemToDocChunk(it) }));
    log.info(`x23 vectorSearch: ${pairs.length} docs`);
    metrics.addDocs(pairs.length);
    return pairs;
  }

  async vectorSearch(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; similarityThreshold?: number; limit?: number }): Promise<DocChunk[]> {
    const pairs = await this.vectorSearchRaw(q);
    return pairs.map((p) => p.doc);
  }

  /** Hybrid (keyword + vector) search. (raw + mapped) */
  async hybridSearchRaw(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; similarityThreshold?: number; limit?: number }): Promise<{ raw: any; doc: DocChunk }[]> {
    type Resp = { status: string; result: { results: any[] } };
    const body = {
      query: q.query,
      protocols: q['protocols'] ?? [],
      itemTypes: q['itemTypes'] ?? [],
      limit: q.topK ?? q['limit'] ?? 5,
      similarityThreshold: q['similarityThreshold'] ?? 0.4,
    };
    const data = await this.req<Resp>('/hybridSearch', { method: 'POST', body: JSON.stringify(body) });
    const results = data.result?.results ?? [];
    const pairs = results.map((it) => ({ raw: it, doc: this.mapItemToDocChunk(it) }));
    log.info(`x23 hybridSearch: ${pairs.length} docs`);
    metrics.addDocs(pairs.length);
    return pairs;
  }

  async hybridSearch(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; similarityThreshold?: number; limit?: number }): Promise<DocChunk[]> {
    const pairs = await this.hybridSearchRaw(q);
    return pairs.map((p) => p.doc);
  }

  /** Hybrid search limited to official docs and synthesize an answer with citations. */
  async officialHybridAnswer(q: SearchQuery & { protocols?: string[]; similarityThreshold?: number; limit?: number; realtime?: boolean }): Promise<AnswerSynthesis> {
    type Resp = { status: string; result: { results: any[]; answer?: string; rationale?: string[] } };
    const body = {
      query: q.query,
      protocols: q['protocols'] ?? [],
      limit: q.topK ?? q['limit'] ?? 5,
      similarityThreshold: q['similarityThreshold'] ?? 0.4,
      realtime: q['realtime'] ?? false,
    };
    const data = await this.req<Resp>('/officialDocSearch', { method: 'POST', body: JSON.stringify(body) });
    const results = data.result?.results ?? [];
    const citations = results.map((it) => this.mapItemToDocChunk(it));
    const ret: AnswerSynthesis = { answer: data.result?.answer ?? '', citations, citationsRaw: results };
    log.info(`x23 officialDoc detail: ${citations.length} citations, answer=${ret.answer ? 'yes' : 'no'}`);
    metrics.addDocs(citations.length);
    return ret;
  }

  /** Retrieve raw discussion posts from a specific thread URI or id. */
  async getDiscussionPosts(
    input:
      | string
      | {
          discussionUrl: string;
          topicId: string;
          minimumUnix?: number;
        }
  ): Promise<DiscussionPost[]> {
    type Resp = { status: string; result: { rawPosts: string } };
    let discussionUrl: string | undefined;
    let topicId: string | undefined;
    let minimumUnix: number = 0;

    if (typeof input === 'string') {
      // Best-effort parse from URL; require full URL for robustness
      discussionUrl = input;
      const m = input.match(/(\d+)(?!.*\d)/);
      if (m) topicId = m[1];
    } else {
      discussionUrl = input.discussionUrl;
      topicId = input.topicId;
      minimumUnix = input.minimumUnix ?? 0;
    }

    if (!discussionUrl || !topicId) {
      throw new Error('getDiscussionPosts requires a full discussionUrl and topicId');
    }

    const body = { discussionUrl, topicId, minimumUnix };
    const data = await this.req<Resp>('/rawPosts', { method: 'POST', body: JSON.stringify(body) });
    const raw = data.result?.rawPosts ?? '';
    const ret = [
      {
        id: `${topicId}:raw`,
        body: raw,
        uri: discussionUrl,
      },
    ];
    log.info(`x23 rawPosts: ${raw ? raw.length : 0} chars returned`);
    metrics.addDocs(ret.length);
    return ret;
  }

  /** Retrieve chronological timeline items related to an entity or URI. */
  async getTimeline(ogItem: Record<string, unknown>, opts?: { restrictToProtocol?: boolean; scoreMatch?: number }): Promise<TimelineItem[]> {
    type Resp = { status: string; result: { timeline: any[] } };
    const body = {
      ogItem,
      restrictToProtocol: opts?.restrictToProtocol ?? true,
      scoreMatch: opts?.scoreMatch ?? 0.76,
    };
    const data = await this.req<Resp>('/timeline', { method: 'POST', body: JSON.stringify(body) });
    const items = data.result?.timeline ?? [];
    const ret = items.map((it) => ({
      id: String(it.id),
      label: it.title || it.headline || String(it.id),
      timestamp: this.toIso(it.updated ?? it.created) || new Date().toISOString(),
      uri: it.appUrl || it.sourceUrl,
      meta: { protocol: it.protocol, type: it.type },
    }));
    log.info(`x23 timeline: ${ret.length} items`);
    metrics.addDocs(ret.length);
    return ret;
  }
}

// Additional useful tools (recommended):

/** Fetch a URL and extract readable content (HTML → text, metadata). */
export async function fetchUrlContent(url: string): Promise<{
  url: string;
  title?: string;
  text?: string;
  meta?: Record<string, unknown>;
}> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'ai-delegate/1.0' } });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('text/html')) return { url };
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    return { url, title, text, meta: { contentType: ct } };
  } catch {
    return { url };
  } finally {
    clearTimeout(to);
  }
}

/** Score source credibility based on domain, authorship, and cross-references. */
export function scoreSourceCredibility(chunk: DocChunk): number {
  let score = 0;
  const uri = chunk.uri || '';
  const source = (chunk.source || '').toLowerCase();
  // Source type weighting
  if (source === 'officialdoc') score += 0.6;
  else if (source === 'onchain') score += 0.45;
  else if (source === 'snapshot') score += 0.35;
  else if (source === 'discussion') score += 0.2;
  else if (source === 'code' || source === 'pullrequest') score += 0.25;
  // Domain heuristics
  if (/gov\.optimism\.io|snapshot\.org|github\.com|docs\./i.test(uri)) score += 0.15;
  // Recency boost
  if (chunk.publishedAt) {
    try {
      const ageMs = Date.now() - new Date(chunk.publishedAt).getTime();
      const oneYear = 365 * 24 * 60 * 60 * 1000;
      if (ageMs < oneYear) score += 0.1;
      else if (ageMs < 2 * oneYear) score += 0.05;
    } catch {}
  }
  // Fallback to provided score hint
  if (typeof chunk.score === 'number') score += 0.1 * Math.tanh(chunk.score / 10);
  return Math.max(0, Math.min(1, score));
}

/** Extract claims and entities from text to aid fact checking. */
export function extractClaims(text: string): Array<{ claim: string }> {
  // TODO: LLM-powered or rule-based claim extraction
  return [];
}
