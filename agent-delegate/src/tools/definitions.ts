import { AVAILABLE_PROTOCOLS, AVAILABLE_ITEM_TYPES, DISCUSSION_URL } from '../utils/x23Config.js';

// Tool selection (x23) — prompts and schemas centralized for easy editing

export const SEARCH_TOOL_SELECTOR_SYSTEM_PROMPT = [
  'You are a search tool selector for fact checking governance claims. Choose exactly one search tool and parameters to retrieve evidence.',
  "- Search tools: keyword, vector, hybrid, or 'none' if no search is needed.",
  '- For keyword/vector/hybrid: output a short, concise keyword query (<= 10 words), optimized for search engines. Avoid filler words.',
  `- Available protocols: ${AVAILABLE_PROTOCOLS.join(', ')} (default to these if unset).`,
  `- Allowed itemTypes: ${AVAILABLE_ITEM_TYPES.join(', ')} (subset as needed).`,
  'Do not include rawPosts here — that is a separate tool to fetch raw discussion thread content when needed later.',
  'Return JSON with tool, query, and relevant parameters only.',
].join('\n');

export const SEARCH_TOOL_SELECTOR_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string', enum: ['hybrid', 'vector', 'keyword', 'none'] },
    query: { type: 'string' },
    limit: { type: 'number' },
    similarityThreshold: { type: 'number' },
    protocols: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: AVAILABLE_PROTOCOLS as any },
    },
    itemTypes: {
      type: 'array',
      items: { type: 'string', enum: AVAILABLE_ITEM_TYPES as any },
    },
    // no generic realtime flag in search selection; handled in a separate official-doc detail step
  },
  required: ['tool'],
} as const;

// Seed search planning — prompts and schemas
export const SEED_SEARCH_SYSTEM_PROMPT = [
  'You generate a concise keyword-style search query (<= 10 words) optimized for search engines to retrieve governance docs and official references.',
  `If clear, include protocols as a subset of: ${AVAILABLE_PROTOCOLS.join(', ')}. Otherwise, omit protocols.`,
  'Return JSON with { query, protocols? } only.',
].join('\n');

export const SEED_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    protocols: { type: 'array', items: { type: 'string', enum: AVAILABLE_PROTOCOLS as any } },
  },
  required: ['query'],
} as const;

// Decide whether to fetch raw posts for a discussion thread for more context
export const RAW_POSTS_DECISION_PROMPT = [
  'You decide if more context is required from a discussion thread to evaluate the claim.',
  '- If the most relevant evidence is a discussion item and the digest/snippet seems insufficient to judge the claim, request raw posts.',
  `- Raw posts must use discussionUrl=${DISCUSSION_URL} and provide topicId. Extract topicId from the discussion URI if needed (the last numeric segment).`,
  'Return JSON: { useRawPosts: boolean, discussionUrl?: string, topicId?: string, minimumUnix?: number }',
].join('\n');

export const RAW_POSTS_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    useRawPosts: { type: 'boolean' },
    discussionUrl: { type: 'string', enum: [DISCUSSION_URL] as any },
    topicId: { type: 'string' },
    minimumUnix: { type: 'number' },
  },
  required: ['useRawPosts'],
} as const;

// Optional: request a more detailed official-docs answer (post-citation)
export const OFFICIAL_DETAIL_DECISION_PROMPT = [
  'You decide if more detail is needed from official documentation beyond the digest/snippet to evaluate the claim.',
  '- WARNING: official detail (realtime) is slow. Prefer evaluating the cited docs directly if possible.',
  '- Only use official detail when there is a single, specific officialDoc URL clearly relevant to the claim AND an answer must be extracted from deep inside that document.',
  'Return JSON: { useOfficialDetail: boolean, question?: string } (ask a short specific question if true).',
].join('\n');

export const OFFICIAL_DETAIL_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    useOfficialDetail: { type: 'boolean' },
    question: { type: 'string' },
  },
  required: ['useOfficialDetail'],
} as const;

// Decide if a claim appears policy/compliance/governance-rules oriented
export const OFFICIAL_FIRST_DECISION_PROMPT = [
  'You decide if the claim is policy/compliance/governance-rules oriented and should consult official documentation first.',
  '- Consider the claim text, provided hints, proposal title/description, and known protocols.',
  '- Prefer official-doc-first when the claim touches constitutions, charters, mandates, rules, laws, requirement checklists, formal guidelines, framework definitions, or protocol-specific policy docs.',
  'Return JSON: { preferOfficialFirst: boolean } only.',
].join('\n');

export const OFFICIAL_FIRST_DECISION_SCHEMA = {
  type: 'object',
  properties: { preferOfficialFirst: { type: 'boolean' } },
  required: ['preferOfficialFirst'],
} as const;

// Query rewrite (search-optimized, concise)
export const QUERY_REWRITE_SYSTEM_PROMPT = [
  'Rewrite the input search query into a concise keyword-style form (<= 10 words) optimized for search engines.',
  '- Preserve critical entities and identifiers (protocol names, tickers, topic IDs, proposal IDs, repo/name).',
  '- Avoid filler words; prefer nouns and exact artifact names.',
  'Return JSON { query: string } only.',
].join('\n');

export const QUERY_REWRITE_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
} as const;
