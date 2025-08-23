import type { LLMClient, LLMProvider } from './types.js';
import { createOpenAIClient } from './openai.js';

export function createLLM(provider?: LLMProvider): LLMClient {
  const p = provider || (process.env.LLM_PROVIDER as LLMProvider) || 'openai';
  if (p === 'openai') return createOpenAIClient();

  // Fallback stub LLM for development without keys
  return {
    async generateText(system: string, prompt: string) {
      return `[stub llm] ${prompt.slice(0, 140)}`;
    },
    async extractJSON<T>(system: string, prompt: string, _schema: object, _opts?: any) {
      const fake: any = { satisfied: true, reason: 'stub' };
      return fake as T;
    },
  };
}

export type { LLMClient } from './types.js';
