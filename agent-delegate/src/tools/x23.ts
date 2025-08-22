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
    let bodyPreview: string | undefined;
    try {
      const b = (init as any)?.body;
      if (typeof b === 'string') bodyPreview = b;
      else if (b) bodyPreview = JSON.stringify(b);
    } catch {}
    log.info(`${colors.cyan('x23 request')} → ${method} ${path}`, bodyPreview ? { body: bodyPreview } : undefined);
    const spinner = log.spinner(`x23 ${method} ${path}`);
    try {
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

  /** Keyword-only search across indexed sources. */
  async keywordSearch(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; limit?: number; sortByRelevance?: boolean }): Promise<DocChunk[]> {
    type Resp = { status: string; result: { results: any[] } };
    const body = {
      query: q.query,
      sortByRelevance: q['sortByRelevance'] ?? true,
      protocols: q['protocols'] ?? [],
      itemTypes: q['itemTypes'] ?? [],
      limit: q.topK ?? q['limit'] ?? 20,
    };
    const data = await this.req<Resp>('/keywordSearch', { method: 'POST', body: JSON.stringify(body) });
    const ret = (data.result?.results ?? []).map((it) => this.mapItemToDocChunk(it));
    log.info(`x23 keywordSearch: ${ret.length} docs`);
    return ret;
  }

  /** Vector/RAG semantic search. */
  async vectorSearch(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; similarityThreshold?: number; limit?: number }): Promise<DocChunk[]> {
    type Resp = { status: string; result: { results: any[] } };
    const body = {
      query: q.query,
      similarityThreshold: q['similarityThreshold'] ?? 0.4,
      protocols: q['protocols'] ?? [],
      itemTypes: q['itemTypes'] ?? [],
      limit: q.topK ?? q['limit'] ?? 5,
    };
    const data = await this.req<Resp>('/ragSearch', { method: 'POST', body: JSON.stringify(body) });
    const ret = (data.result?.results ?? []).map((it) => this.mapItemToDocChunk(it));
    log.info(`x23 vectorSearch: ${ret.length} docs`);
    return ret;
  }

  /** Hybrid (keyword + vector) search. */
  async hybridSearch(q: SearchQuery & { protocols?: string[]; itemTypes?: string[]; similarityThreshold?: number; limit?: number }): Promise<DocChunk[]> {
    type Resp = { status: string; result: { results: any[] } };
    const body = {
      query: q.query,
      protocols: q['protocols'] ?? [],
      itemTypes: q['itemTypes'] ?? [],
      limit: q.topK ?? q['limit'] ?? 5,
      similarityThreshold: q['similarityThreshold'] ?? 0.4,
    };
    const data = await this.req<Resp>('/hybridSearch', { method: 'POST', body: JSON.stringify(body) });
    const ret = (data.result?.results ?? []).map((it) => this.mapItemToDocChunk(it));
    log.info(`x23 hybridSearch: ${ret.length} docs`);
    return ret;
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
    const citations = (data.result?.results ?? []).map((it) => this.mapItemToDocChunk(it));
    const ret = { answer: data.result?.answer ?? '', citations };
    log.info(`x23 officialDoc detail: ${ret.citations.length} citations, answer=${ret.answer ? 'yes' : 'no'}`);
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
  // TODO: implement with a safe fetcher and readability extraction service
  return { url };
}

/** Score source credibility based on domain, authorship, and cross-references. */
export function scoreSourceCredibility(chunk: DocChunk): number {
  // TODO: implement a heuristic (domain whitelist, recency, authorship)
  return chunk.score ?? 0;
}

/** Extract claims and entities from text to aid fact checking. */
export function extractClaims(text: string): Array<{ claim: string }> {
  // TODO: LLM-powered or rule-based claim extraction
  return [];
}
