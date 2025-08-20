import { readFileSync } from 'fs';
import { resolve } from 'path';

const cache = new Map<string, string>();

export function loadRolePrompt(relPath: string): string {
  const key = resolve(relPath);
  if (cache.has(key)) return cache.get(key)!;
  const text = readFileSync(key, 'utf-8');
  cache.set(key, text);
  return text;
}

