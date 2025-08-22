import type { LLMClient } from '../llm/index.js';
import type { AgentContext } from '../agents/types.js';
import type { DocChunk } from './x23.js';
import {
  SEARCH_TOOL_SELECTOR_SYSTEM_PROMPT,
  SEARCH_TOOL_SELECTOR_SCHEMA,
  RAW_POSTS_DECISION_PROMPT,
  RAW_POSTS_DECISION_SCHEMA,
  OFFICIAL_DETAIL_DECISION_PROMPT,
  OFFICIAL_DETAIL_DECISION_SCHEMA,
  QUERY_REWRITE_SYSTEM_PROMPT,
  QUERY_REWRITE_SCHEMA,
  OFFICIAL_FIRST_DECISION_PROMPT,
  OFFICIAL_FIRST_DECISION_SCHEMA,
} from './definitions.js';
import { AVAILABLE_ITEM_TYPES, AVAILABLE_PROTOCOLS, DISCUSSION_URL } from '../utils/x23Config.js';

// Small helper to prefix prompts with the agent role text when available
function sys(role: string | undefined, suffix: string): string {
  return role ? `${role}\n\n${suffix}` : suffix;
}

export type SearchToolPlan = {
  tool: 'hybrid' | 'vector' | 'keyword' | 'none';
  query?: string;
  limit?: number;
  similarityThreshold?: number;
  protocols?: string[];
  itemTypes?: string[];
};

function sanitizeToolPlan(plan: SearchToolPlan): SearchToolPlan {
  const sanitized: SearchToolPlan = { ...plan };
  if (Array.isArray(plan.protocols)) {
    const filtered = plan.protocols
      .map((p) => (typeof p === 'string' ? p.trim().toLowerCase() : ''))
      .filter((p) => p && AVAILABLE_PROTOCOLS.includes(p));
    if (filtered.length) sanitized.protocols = filtered;
    else delete (sanitized as any).protocols;
  }
  if (Array.isArray(plan.itemTypes)) {
    const filtered = plan.itemTypes.filter((t) => AVAILABLE_ITEM_TYPES.includes(t));
    if (filtered.length) sanitized.itemTypes = filtered;
    else delete (sanitized as any).itemTypes;
  }
  return sanitized;
}

export async function selectSearchTool(
  ctx: AgentContext,
  llm: LLMClient,
  params: { rolePrompt?: string; claimOrQuery: string; hints?: string[]; payloadDigest?: string; previouslyTried?: any[] }
): Promise<SearchToolPlan> {
  const { rolePrompt, claimOrQuery, hints, payloadDigest, previouslyTried } = params;
  const body = previouslyTried
    ? `Claim: ${claimOrQuery}\nHints: ${JSON.stringify(hints || [])}\nProvidedPayload:\n${payloadDigest || '(none)'}\nPreviouslyTried: ${JSON.stringify(previouslyTried)}`
    : `Claim: ${claimOrQuery}\nHints: ${JSON.stringify(hints || [])}\nSeedTitle: ${ctx.proposal.title || ''}\nProvidedPayload:\n${payloadDigest || '(none)'}`;
  const plan = await llm.extractJSON<SearchToolPlan>(
    sys(rolePrompt, SEARCH_TOOL_SELECTOR_SYSTEM_PROMPT),
    body,
    SEARCH_TOOL_SELECTOR_SCHEMA as any,
    { schemaName: 'searchToolPlan', maxOutputTokens: 2500 }
  );
  // Optional query rewrite to concise keyword form
  const vRewrite = String(process.env.FACT_ENABLE_QUERY_REWRITE || '1').toLowerCase();
  const enableRewrite = !(vRewrite === '0' || vRewrite === 'false' || vRewrite === 'no');
  if (enableRewrite && plan && typeof plan.query === 'string') {
    try {
      const rewrite = await llm.extractJSON<{ query: string }>(
        sys(rolePrompt, QUERY_REWRITE_SYSTEM_PROMPT),
        `Claim: ${claimOrQuery}\nOriginalQuery: ${plan.query || ''}\nTitle: ${ctx.proposal.title || ''}`,
        QUERY_REWRITE_SCHEMA as any,
        { schemaName: 'queryRewrite', maxOutputTokens: 2000 }
      );
      const before = (plan.query || '').trim();
      const after = (rewrite?.query || '').trim();
      const mustPreserve: string[] = [];
      (before.match(/\b\d+\b/g) || []).forEach((m) => mustPreserve.push(m));
      AVAILABLE_PROTOCOLS.forEach((p) => {
        if (before.toLowerCase().includes(p)) mustPreserve.push(p);
      });
      const preserves = mustPreserve.every((t) => after.toLowerCase().includes(t.toLowerCase()));
      if (after && after.length <= before.length && preserves) {
        (plan as any).query = after;
      }
    } catch {}
  }
  return sanitizeToolPlan(plan);
}

export async function runSearchTool(
  ctx: AgentContext,
  plan: SearchToolPlan,
  fallbackQuery: string
): Promise<{ docs: DocChunk[]; attempts: any[]; answer?: string; raws?: any[] }> {
  const topK = plan.limit ?? 6;
  const requestedProtocols = plan.protocols || [];
  const filteredProtocols = requestedProtocols.filter((p) => AVAILABLE_PROTOCOLS.includes(p));
  const protocols = filteredProtocols.length ? filteredProtocols : AVAILABLE_PROTOCOLS;
  const itemTypes = (plan.itemTypes || []).filter((t) => AVAILABLE_ITEM_TYPES.includes(t));
  const safeItemTypes = itemTypes.length ? itemTypes : undefined;
  const attempts: any[] = [];
  const q = plan.query || fallbackQuery;
  async function tryHybrid(th?: number, broaden?: boolean) {
    const params: any = {
      query: q,
      topK,
      protocols,
      similarityThreshold: th ?? plan.similarityThreshold,
    };
    if (!broaden && safeItemTypes) params.itemTypes = safeItemTypes;
    const pairs = await (ctx.x23 as any).hybridSearchRaw(params);
    const docs = pairs.map((p: any) => p.doc);
    const raws = pairs.map((p: any) => p.raw);
    attempts.push({ tool: 'hybrid', query: q, similarityThreshold: params.similarityThreshold, itemTypes: params.itemTypes, resultCount: docs.length });
    return { docs, raws };
  }
  async function tryVector(th?: number, broaden?: boolean) {
    const params: any = {
      query: q,
      topK,
      protocols,
      similarityThreshold: th ?? plan.similarityThreshold,
    };
    if (!broaden && safeItemTypes) params.itemTypes = safeItemTypes;
    const pairs = await (ctx.x23 as any).vectorSearchRaw(params);
    const docs = pairs.map((p: any) => p.doc);
    const raws = pairs.map((p: any) => p.raw);
    attempts.push({ tool: 'vector', query: q, similarityThreshold: params.similarityThreshold, itemTypes: params.itemTypes, resultCount: docs.length });
    return { docs, raws };
  }
  async function tryKeyword(broaden?: boolean) {
    const params: any = { query: q, topK, protocols };
    if (!broaden && safeItemTypes) params.itemTypes = safeItemTypes;
    const pairs = await (ctx.x23 as any).keywordSearchRaw(params);
    const docs = pairs.map((p: any) => p.doc);
    const raws = pairs.map((p: any) => p.raw);
    attempts.push({ tool: 'keyword', query: q, itemTypes: params.itemTypes, resultCount: docs.length });
    return { docs, raws };
  }
  if (plan.tool === 'none') {
    return { docs: [], attempts };
  }
  if (plan.tool === 'hybrid') {
    let { docs, raws } = await tryHybrid();
    if (docs.length === 0) {
      const lowered = Math.max(0.15, (plan.similarityThreshold ?? 0.4) - 0.1);
      ({ docs, raws } = await tryHybrid(lowered, true));
    }
    if (docs.length === 0) docs = await tryKeyword(true);
    return { docs, attempts, raws };
  }
  if (plan.tool === 'vector') {
    let { docs, raws } = await tryVector();
    if (docs.length === 0) {
      const lowered = Math.max(0.15, (plan.similarityThreshold ?? 0.4) - 0.1);
      ({ docs, raws } = await tryVector(lowered, true));
    }
    if (docs.length === 0) {
      const hybrid = await tryHybrid((plan.similarityThreshold ?? 0.4) - 0.05, true);
      docs = hybrid.docs; raws = hybrid.raws;
    }
    return { docs, attempts, raws };
  }
  if (plan.tool === 'keyword') {
    let { docs, raws } = await tryKeyword();
    if (docs.length === 0) {
      const hybrid = await tryHybrid(0.3, true);
      docs = hybrid.docs; raws = hybrid.raws;
    }
    return { docs, attempts, raws };
  }
  return { docs: [], attempts };
}

export async function maybeExpandWithRawPosts(
  ctx: AgentContext,
  llm: LLMClient,
  rolePrompt: string | undefined,
  claim: string,
  docs: DocChunk[]
): Promise<DocChunk | undefined> {
  try {
    const top = docs.find((d) => (d.source || '').toLowerCase().includes('discussion')) || docs[0];
    if (!top || !top.uri) return undefined;
    const decision = await llm.extractJSON<{
      useRawPosts: boolean;
      discussionUrl?: string;
      topicId?: string;
      minimumUnix?: number;
    }>(
      sys(rolePrompt, RAW_POSTS_DECISION_PROMPT),
      `Claim: ${claim}\nDoc: ${JSON.stringify(top)}`,
      RAW_POSTS_DECISION_SCHEMA as any,
      { schemaName: 'rawPostsDecision', maxOutputTokens: 4000 }
    );
    if (!decision.useRawPosts) return undefined;
    const discussionUrl = DISCUSSION_URL;
    let topicId = decision.topicId;
    if (!topicId && typeof top.uri === 'string') {
      const m = top.uri.match(/(\d+)(?!.*\d)/);
      if (m) topicId = m[1];
    }
    if (!topicId) return undefined;
    const posts = await ctx.x23.getDiscussionPosts({ discussionUrl, topicId, minimumUnix: decision.minimumUnix });
    const rawDoc: DocChunk = { id: `${topicId}:raw`, title: 'Discussion raw posts', uri: discussionUrl, snippet: posts[0]?.body?.slice(0, 1200), source: 'discussion' };
    return rawDoc;
  } catch {
    return undefined;
  }
}

export async function maybeExpandWithOfficialDetail(
  ctx: AgentContext,
  llm: LLMClient,
  rolePrompt: string | undefined,
  claim: string,
  docs: DocChunk[]
): Promise<DocChunk | undefined> {
  try {
    const hasOfficial = docs.some((d) => (d.source || '').toLowerCase() === 'officialdoc');
    if (!hasOfficial) return undefined;
    const decision = await llm.extractJSON<{ useOfficialDetail: boolean; question?: string }>(
      sys(rolePrompt, OFFICIAL_DETAIL_DECISION_PROMPT),
      `Claim: ${claim}\nOfficialCitations: ${JSON.stringify(docs.filter((d) => (d.source || '').toLowerCase() === 'officialdoc').slice(0, 3))}`,
      OFFICIAL_DETAIL_DECISION_SCHEMA as any,
      { schemaName: 'officialDetailDecision', maxOutputTokens: 4000 }
    );
    if (!decision.useOfficialDetail) return undefined;
    const q = (decision.question || claim).slice(0, 256);
    const ans = await ctx.x23.officialHybridAnswer({ query: q, topK: 5, protocols: AVAILABLE_PROTOCOLS, similarityThreshold: 0.4, realtime: true });
    const doc: DocChunk = { id: 'official-detail', title: 'Official doc detail', snippet: ans.answer?.slice(0, 1200), source: 'officialDoc' };
    return doc;
  } catch {
    return undefined;
  }
}

export async function findEvidenceForClaim(
  ctx: AgentContext,
  llm: LLMClient,
  rolePrompt: string | undefined,
  claim: string,
  hints?: string[],
  opts?: { seenUris?: Set<string> }
): Promise<{ docs: DocChunk[]; attempts: any[] }> {
  // Shared cache: ctx.cache -> evidenceCache (Map)
  const cacheKeyRoot = 'evidenceCache';
  const cacheMap = ((): Map<string, { ts: number; docs: DocChunk[]; attempts: any[] }> => {
    if (!ctx.cache) return new Map();
    const existing = ctx.cache.get(cacheKeyRoot) as Map<string, { ts: number; docs: DocChunk[]; attempts: any[] }> | undefined;
    if (existing) return existing;
    const m = new Map<string, { ts: number; docs: DocChunk[]; attempts: any[] }>();
    ctx.cache.set(cacheKeyRoot, m);
    return m;
  })();
  const normClaim = (claim || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const normHints = (hints || []).map((h) => (h || '').toLowerCase().trim()).filter(Boolean).sort();
  const cacheKey = JSON.stringify({ c: normClaim, h: normHints });
  const ttlMs = Number(process.env.EVIDENCE_CACHE_TTL_MS || 10 * 60 * 1000);
  const now = Date.now();
  const fromCache = cacheMap.get(cacheKey);
  if (fromCache && now - fromCache.ts < ttlMs) {
    const pruned = dedupByUri(fromCache.docs, opts?.seenUris);
    return { docs: pruned, attempts: fromCache.attempts || [] };
  }
  const payloadDigest = (ctx.proposal.payload || [])
    .slice(0, 8)
    .map((p, i) => `P${i + 1}: [${p.type}] ${p.uri || ''} :: ${JSON.stringify(p.data || p.metadata || {}).slice(0, 160)}`)
    .join('\n');

  const tried: any[] = [];
  // Optional: prefer official-doc search first for policy/compliance claims or when globally enabled
  const attempts: any[] = [];
  const preferOfficialAll = String(process.env.OFFICIAL_FIRST_ALL || '').toLowerCase();
  let preferOfficial =
    preferOfficialAll === '1' || preferOfficialAll === 'true' || preferOfficialAll === 'yes';
  if (!preferOfficial) {
    try {
      const dec = await llm.extractJSON<{ preferOfficialFirst: boolean }>(
        sys(rolePrompt, OFFICIAL_FIRST_DECISION_PROMPT),
        `Claim: ${claim}\nHints: ${JSON.stringify(hints || [])}\nTitle: ${ctx.proposal.title || ''}\nDescription: ${String(ctx.proposal.description || '').slice(0, 400)}`,
        OFFICIAL_FIRST_DECISION_SCHEMA as any,
        { schemaName: 'officialFirstDecision', maxOutputTokens: 1000 }
      );
      preferOfficial = !!dec?.preferOfficialFirst;
    } catch {
      // fallback heuristic if LLM decision fails
      preferOfficial = isPolicyLikeClaim(claim) || (hints || []).some((h) => isPolicyHint(h));
    }
  }
  if (preferOfficial) {
    try {
      const ans = await ctx.x23.officialHybridAnswer({
        query: claim.slice(0, 256),
        protocols: AVAILABLE_PROTOCOLS,
        topK: 6,
        similarityThreshold: 0.4,
        realtime: true,
      });
      const docsOff = (ans.citations || []).slice(0, 6);
      attempts.push({ tool: 'officialDoc', query: claim, resultCount: docsOff.length });
      if (docsOff.length > 0) {
        // Represent the detailed answer as an additional pseudo-doc, then citations
        const detail: DocChunk = { id: 'official-detail', title: 'Official doc detail', snippet: ans.answer?.slice(0, 1000), source: 'officialDoc' };
        let docs = [detail, ...docsOff];
        // Timeline enrichment using raw citation if available
        try {
          const raw0 = (ans as any).citationsRaw?.[0];
          if (raw0) {
            const items = await ctx.x23.getTimeline(raw0, { scoreMatch: 0.2 });
            const tlDocs: DocChunk[] = items.slice(0, 5).map((it, i) => ({
              id: `tl-${i}-${it.id}`,
              title: `Timeline: ${it.label}`,
              uri: it.uri,
              snippet: `${it.timestamp} ${(it.meta?.type ? `[${String(it.meta?.type)}] ` : '')}${it.label}`,
              source: 'timeline',
              score: 1,
            }));
            docs = tlDocs.concat(docs);
          }
        } catch {}
        docs = dedupByUri(docs, opts?.seenUris);
        cacheMap.set(cacheKey, { ts: now, docs, attempts });
        return { docs, attempts };
      }
    } catch {
      // ignore and fall back
    }
  }

  for (let iter = 0; iter < Math.max(1, Math.min(3, Number(process.env.REASONER_MAX_FACT_ITERS || '2'))); iter++) {
    const plan = await selectSearchTool(ctx, llm, { rolePrompt, claimOrQuery: claim, hints, payloadDigest, previouslyTried: tried });
    tried.push({ tool: plan.tool, query: plan.query });
    const exec = await runSearchTool(ctx, plan, claim);
    const rawDoc = await maybeExpandWithRawPosts(ctx, llm, rolePrompt, claim, exec.docs);
    const offDoc = await maybeExpandWithOfficialDetail(ctx, llm, rolePrompt, claim, exec.docs);
    let docs = [rawDoc, offDoc].filter(Boolean).concat(exec.docs) as DocChunk[];
    // Timeline enrichment for temporal/process claims
    if (/timeline|phase|epoch|deadline|date|snapshot|onchain|vote|voting|prop(ose|osal)/i.test(claim)) {
      try {
        const topDoc = exec.docs[0] || docs[0];
        const topRaw = (exec as any).raws && (exec as any).raws[0];
        if (topRaw || topDoc?.uri) {
          const ogItem = topRaw || { sourceUrl: topDoc?.uri, title: topDoc?.title || '' };
          const items = await ctx.x23.getTimeline(ogItem, { scoreMatch: 0.2 });
          const tlDocs: DocChunk[] = items.slice(0, 5).map((it, i) => ({
            id: `tl-${i}-${it.id}`,
            title: `Timeline: ${it.label}`,
            uri: it.uri,
            snippet: `${it.timestamp} ${(it.meta?.type ? `[${String(it.meta?.type)}] ` : '')}${it.label}`,
            source: 'timeline',
            score: 1,
          }));
          docs = tlDocs.concat(docs);
        }
      } catch {}
    }
    docs = dedupByUri(docs, opts?.seenUris);
    if (docs.length > 0) {
      const atts = attempts.concat(exec.attempts || []);
      cacheMap.set(cacheKey, { ts: now, docs, attempts: atts });
      return { docs, attempts: atts };
    }
  }
  const atts = attempts.concat(tried);
  cacheMap.set(cacheKey, { ts: now, docs: [], attempts: atts });
  return { docs: [], attempts: atts };
}

function dedupByUri(docs: DocChunk[], seen?: Set<string>): DocChunk[] {
  const out: DocChunk[] = [];
  const local = new Set<string>();
  for (const d of docs) {
    const u = (d.uri || '').trim();
    if (!u) continue;
    if (local.has(u)) continue;
    if (seen && seen.has(u)) continue;
    local.add(u);
    if (seen) seen.add(u);
    out.push(d);
  }
  return out;
}

export async function planSeedSearch(
  ctx: AgentContext,
  llm: LLMClient,
  rolePrompt: string | undefined
): Promise<{ query: string; protocols?: string[] }> {
  const { SEED_SEARCH_SYSTEM_PROMPT, SEED_SEARCH_SCHEMA } = await import('./definitions.js');
  const sys = (s: string) => (rolePrompt ? `${rolePrompt}\n\n${s}` : s);
  const payload = (ctx.proposal.payload || [])
    .slice(0, 6)
    .map((p, i) =>
      `P${i + 1} [${p.type}] ${p.uri || ''} :: ${JSON.stringify(p.data || p.metadata || {}).slice(0, 140)}`
    )
    .join('\n');
  const seedPlan = await llm.extractJSON<{ query: string; protocols?: string[] }>(
    sys(SEED_SEARCH_SYSTEM_PROMPT),
    `Title: ${ctx.proposal.title}\nDescription: ${ctx.proposal.description}\nPayloadDigest:\n${payload || '(none)'}\n`,
    SEED_SEARCH_SCHEMA as any,
    { schemaName: 'seedSearchPlan', maxOutputTokens: 2000 }
  );
  return seedPlan;
}

function isPolicyHint(h: string): boolean {
  const s = (h || '').toLowerCase();
  return /policy|charter|manual|law|constitution|guideline|rules?|mandate|terms|framework/.test(s);
}
function isPolicyLikeClaim(c: string): boolean {
  const s = (c || '').toLowerCase();
  return /policy|charter|manual|law|constitution|guideline|rules?|mandate|terms|framework|compliance|official/.test(s);
}
