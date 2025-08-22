import { AVAILABLE_PROTOCOLS, AVAILABLE_ITEM_TYPES, DISCUSSION_URL } from '../utils/x23Config.js';

// Tool selection (x23) — prompts and schemas centralized for easy editing

export const SEARCH_TOOL_SELECTOR_SYSTEM_PROMPT = [
  'You are a search tool selector for fact checking governance claims. Choose exactly one search tool and parameters to retrieve evidence.',
  '- Search tools: keyword, vector, hybrid, officialHybrid.',
  '- For keyword/vector/hybrid: output a short, concise keyword query (<= 10 words), optimized for search engines. Avoid filler words.',
  '- For officialHybrid when you want a synthesized natural-language answer, set realtime=true and produce a natural-language question.',
  '- For officialHybrid when you want matching official docs only, set realtime=false and produce a keyword-style query (<= 10 words).',
  `- Available protocols: ${AVAILABLE_PROTOCOLS.join(', ')} (default to these if unset).`,
  `- Allowed itemTypes: ${AVAILABLE_ITEM_TYPES.join(', ')} (subset as needed).`,
  'Do not include rawPosts here — that is a separate tool to fetch raw discussion thread content when needed later.',
  'Return JSON with tool, query, and relevant parameters only.',
].join('\n');

export const SEARCH_TOOL_SELECTOR_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string', enum: ['officialHybrid', 'hybrid', 'vector', 'keyword'] },
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
    realtime: { type: 'boolean' },
  },
  required: ['tool', 'query'],
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
  `- Raw posts require discussionUrl=${DISCUSSION_URL} and topicId. Extract topicId from the URI (the last numeric segment).`,
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
