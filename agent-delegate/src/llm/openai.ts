import type { LLMClient, LLMGenerateOptions, LLMExtractOptions } from './types.js';

interface OpenAIConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string; // default https://api.openai.com/v1
}

export function createOpenAIClient(config: OpenAIConfig = {}): LLMClient {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  const model = config.model || process.env.OPENAI_MODEL || 'gpt5-mini';
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

  const isReasoningModel = /(^gpt5|^gpt-5)/i.test(model) || /gpt5-mini/i.test(model);

  async function callResponses(body: any): Promise<any> {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI provider');
    const res = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, ...body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI Responses error ${res.status}: ${text}`);
    }
    return await res.json();
  }

  function pickOutputText(json: any): string {
    // Responses API returns a flattened field in some SDKs
    if (typeof json.output_text === 'string' && json.output_text.length) return json.output_text;
    // Fallback: concatenate text content
    const items: any[] = json.output || json.choices || [];
    for (const it of items) {
      if (typeof it === 'string') return it;
      const txt = it?.content?.[0]?.text ?? it?.message?.content;
      if (typeof txt === 'string') return txt;
    }
    // Last resort stringify
    return JSON.stringify(json);
  }

  return {
    async generateText(system: string, prompt: string, opts?: LLMGenerateOptions): Promise<string> {
      const body: any = {
        input: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_output_tokens: opts?.maxOutputTokens ?? 800,
      };
      // Reasoning models like gpt5-mini do not support temperature
      if (!isReasoningModel && typeof opts?.temperature === 'number') {
        body.temperature = opts?.temperature;
      }
      const json = await callResponses(body);
      return pickOutputText(json);
    },

    async extractJSON<T>(system: string, prompt: string, jsonSchema: object, opts?: LLMExtractOptions): Promise<T> {
      const body: any = {
        input: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: opts?.schemaName || 'extraction',
            schema: jsonSchema,
            strict: true,
          },
        },
        max_output_tokens: opts?.maxOutputTokens ?? 800,
      } as any;
      if (!isReasoningModel && typeof opts?.temperature === 'number') {
        body.temperature = opts?.temperature;
      }
      const json = await callResponses(body);
      try {
        const text = pickOutputText(json);
        return JSON.parse(text) as T;
      } catch (e) {
        // Some implementations return a parsed object directly
        if (json.output && typeof json.output === 'object') return json.output as T;
        throw e;
      }
    },
  };
}
