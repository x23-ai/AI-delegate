export interface LLMGenerateOptions {
  temperature?: number;
  maxOutputTokens?: number;
  difficulty?: 'easy' | 'normal' | 'hard';
  model?: string;
}

export interface LLMExtractOptions extends LLMGenerateOptions {
  // Optional name for JSON schema in providers that need it
  schemaName?: string;
}

export interface LLMClient {
  generateText(system: string, prompt: string, opts?: LLMGenerateOptions): Promise<string>;
  extractJSON<T>(system: string, prompt: string, jsonSchema: object, opts?: LLMExtractOptions): Promise<T>;
}

export type LLMProvider = 'openai' | 'stub';
