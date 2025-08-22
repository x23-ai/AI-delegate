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
): Promise<{ docs: DocChunk[]; attempts: any[]; answer?: string }> {
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
    const docs = await ctx.x23.hybridSearch(params);
    attempts.push({ tool: 'hybrid', query: q, similarityThreshold: params.similarityThreshold, itemTypes: params.itemTypes, resultCount: docs.length });
    return docs;
  }
  async function tryVector(th?: number, broaden?: boolean) {
    const params: any = {
      query: q,
      topK,
      protocols,
      similarityThreshold: th ?? plan.similarityThreshold,
    };
    if (!broaden && safeItemTypes) params.itemTypes = safeItemTypes;
    const docs = await ctx.x23.vectorSearch(params);
    attempts.push({ tool: 'vector', query: q, similarityThreshold: params.similarityThreshold, itemTypes: params.itemTypes, resultCount: docs.length });
    return docs;
  }
  async function tryKeyword(broaden?: boolean) {
    const params: any = { query: q, topK, protocols };
    if (!broaden && safeItemTypes) params.itemTypes = safeItemTypes;
    const docs = await ctx.x23.keywordSearch(params);
    attempts.push({ tool: 'keyword', query: q, itemTypes: params.itemTypes, resultCount: docs.length });
    return docs;
  }
  if (plan.tool === 'none') {
    return { docs: [], attempts };
  }
  if (plan.tool === 'hybrid') {
    let docs = await tryHybrid();
    if (docs.length === 0) {
      const lowered = Math.max(0.15, (plan.similarityThreshold ?? 0.4) - 0.1);
      docs = await tryHybrid(lowered, true);
    }
    if (docs.length === 0) docs = await tryKeyword(true);
    return { docs, attempts };
  }
  if (plan.tool === 'vector') {
    let docs = await tryVector();
    if (docs.length === 0) {
      const lowered = Math.max(0.15, (plan.similarityThreshold ?? 0.4) - 0.1);
      docs = await tryVector(lowered, true);
    }
    if (docs.length === 0) docs = await tryHybrid((plan.similarityThreshold ?? 0.4) - 0.05, true);
    return { docs, attempts };
  }
  if (plan.tool === 'keyword') {
    let docs = await tryKeyword();
    if (docs.length === 0) docs = await tryHybrid(0.3, true);
    return { docs, attempts };
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
  hints?: string[]
): Promise<{ docs: DocChunk[]; attempts: any[] }> {
  const payloadDigest = (ctx.proposal.payload || [])
    .slice(0, 8)
    .map((p, i) => `P${i + 1}: [${p.type}] ${p.uri || ''} :: ${JSON.stringify(p.data || p.metadata || {}).slice(0, 160)}`)
    .join('\n');

  const tried: any[] = [];
  for (let iter = 0; iter < Math.max(1, Math.min(3, Number(process.env.REASONER_MAX_FACT_ITERS || '2'))); iter++) {
    const plan = await selectSearchTool(ctx, llm, { rolePrompt, claimOrQuery: claim, hints, payloadDigest, previouslyTried: tried });
    tried.push({ tool: plan.tool, query: plan.query });
    const exec = await runSearchTool(ctx, plan, claim);
    const rawDoc = await maybeExpandWithRawPosts(ctx, llm, rolePrompt, claim, exec.docs);
    const offDoc = await maybeExpandWithOfficialDetail(ctx, llm, rolePrompt, claim, exec.docs);
    const docs = [rawDoc, offDoc].filter(Boolean).concat(exec.docs) as DocChunk[];
    if (docs.length > 0) return { docs, attempts: exec.attempts };
  }
  return { docs: [], attempts: tried };
}

