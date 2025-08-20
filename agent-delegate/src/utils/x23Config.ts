export const AVAILABLE_PROTOCOLS: string[] = (process.env.X23_PROTOCOLS || 'optimism')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const AVAILABLE_ITEM_TYPES: string[] = [
  'discussion',
  'snapshot',
  'onchain',
  'code',
  'pullRequest',
  'officialDoc',
];

export const DISCUSSION_URL: string =
  process.env.X23_DISCUSSION_URL || 'https://gov.optimism.io';

