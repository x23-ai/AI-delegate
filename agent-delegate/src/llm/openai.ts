import type { LLMClient, LLMGenerateOptions, LLMExtractOptions } from './types.js';
import { log, sleep } from '../utils/logger.js';

interface OpenAIConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string; // default https://api.openai.com/v1
}

export function createOpenAIClient(config: OpenAIConfig = {}): LLMClient {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  const model = config.model || process.env.OPENAI_MODEL || 'gpt-5-mini';
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

  const isReasoningModel = /(^gpt5|^gpt-5)/i.test(model) || /gpt-5-mini/i.test(model);

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
      const baseMax = opts?.maxOutputTokens ?? 4000;
      const tempset = !isReasoningModel && typeof opts?.temperature === 'number' ? opts.temperature : undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const maxTokens = Math.min(Math.floor(baseMax * Math.pow(1.5, attempt - 1)), 16000);
        const body: any = {
          input: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          max_output_tokens: maxTokens,
        };
        if (typeof tempset === 'number') body.temperature = tempset;
        log.info(`LLM generateText attempt ${attempt} (max_tokens=${maxTokens}) …`);
        try {
          const json = await callResponses(body);
          const out = pickOutputText(json);
          return out;
        } catch (err) {
          log.error(`LLM generateText attempt ${attempt} failed`, err);
          const backoff = 250 * Math.pow(2, attempt - 1);
          await sleep(backoff);
          if (attempt === 3) throw err;
        }
      }
      throw new Error('unreachable');
    },

    async extractJSON<T>(
      system: string,
      prompt: string,
      jsonSchema: object,
      opts?: LLMExtractOptions
    ): Promise<T> {
      function enforceNoAdditionalProps(schema: any): any {
        if (!schema || typeof schema !== 'object') return schema;
        if (Array.isArray(schema)) return schema.map((s) => enforceNoAdditionalProps(s));
        const out: any = { ...schema };
        if (out.type === 'object') {
          if (out.properties && typeof out.properties === 'object') {
            const newProps: any = {};
            for (const [k, v] of Object.entries(out.properties)) {
              newProps[k] = enforceNoAdditionalProps(v);
            }
            out.properties = newProps;
            // Enforce required includes every property key (per Responses API requirement)
            out.required = Object.keys(newProps);
          }
          if (typeof out.additionalProperties === 'undefined') {
            out.additionalProperties = false;
          }
        }
        if (out.type === 'array' && out.items) {
          out.items = enforceNoAdditionalProps(out.items);
        }
        return out;
      }

      const strictSchema = enforceNoAdditionalProps(jsonSchema);
      const schemaName = opts?.schemaName || 'extraction';
      const DEBUG = String(process.env.LLM_DEBUG_SCHEMA || '').toLowerCase() === '1';
      if (DEBUG) {
        console.log(`[LLM DEBUG] Using schema '${schemaName}':`);
        try { console.log(JSON.stringify(strictSchema, null, 2)); } catch {}
      }
      const baseMax = opts?.maxOutputTokens ?? 4000;
      const tempset = !isReasoningModel && typeof opts?.temperature === 'number' ? opts.temperature : undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const maxTokens = Math.min(Math.floor(baseMax * Math.pow(1.5, attempt - 1)), 16000);
        const body: any = {
          input: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: schemaName,
              schema: strictSchema,
              strict: true,
            },
          },
          max_output_tokens: maxTokens,
        } as any;
        if (typeof tempset === 'number') body.temperature = tempset;
        log.info(`LLM extractJSON '${schemaName}' attempt ${attempt} (max_tokens=${maxTokens}) …`);
        try {
          const json = await callResponses(body);
          const text = pickOutputText(json);
          if (DEBUG) {
            console.log('[LLM DEBUG] Raw response text:');
            console.log(text);
          }
          const raw = JSON.parse(text);
          const { value, errors } = (function validateWrapper() {
          // Inline wrapper to avoid hoisting compile order issues
          function validateAndPrune(
            schema: any,
            value: any,
            path = '$'
          ): { value: any; errors: string[] } {
            const errors: string[] = [];
            if (!schema || typeof schema !== 'object') return { value, errors };
            const type = schema.type;
            if (type === 'object') {
              if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                errors.push(`${path}: expected object`);
                return { value, errors };
              }
              const props = schema.properties || {};
              const required: string[] = schema.required || Object.keys(props);
              const out: any = {};
              for (const k of Object.keys(props)) {
                const res = validateAndPrune(props[k], (value as any)[k], `${path}.${k}`);
                if ((value as any)[k] !== undefined) out[k] = res.value;
                errors.push(...res.errors);
              }
              for (const k of required) {
                if (out[k] === undefined) errors.push(`${path}: missing required '${k}'`);
              }
              return { value: out, errors };
            }
            if (type === 'array') {
              if (!Array.isArray(value)) {
                errors.push(`${path}: expected array`);
                return { value, errors };
              }
              const itemsSchema = schema.items || {};
              const arr: any[] = [];
              (value as any[]).forEach((v, i) => {
                const res = validateAndPrune(itemsSchema, v, `${path}[${i}]`);
                arr.push(res.value);
                errors.push(...res.errors);
              });
              return { value: arr, errors };
            }
            if (type === 'string') {
              if (typeof value !== 'string') {
                if (value == null) {
                  errors.push(`${path}: expected string`);
                } else {
                  value = String(value);
                }
              }
              return { value, errors };
            }
            if (type === 'number' || type === 'integer') {
              if (typeof value !== 'number') {
                const n = Number(value);
                if (!Number.isFinite(n)) errors.push(`${path}: expected number`);
                else value = n;
              }
              return { value, errors };
            }
            if (type === 'boolean') {
              if (typeof value !== 'boolean') {
                if (String(value).toLowerCase() === 'true') value = true;
                else if (String(value).toLowerCase() === 'false') value = false;
                else errors.push(`${path}: expected boolean`);
              }
              return { value, errors };
            }
            return { value, errors };
          }
          return validateAndPrune(strictSchema, raw);
          })();
          if (errors.length) {
            if (DEBUG) console.error('[LLM DEBUG] Validation errors:', errors);
            throw new Error(`LLM JSON failed schema validation: ${errors.join('; ')}`);
          }
          return value as T;
        } catch (e) {
          // Fallback: if API provided object, validate it
          // Note: not all providers return this field
          const j: any = (e as any)?.json ?? undefined;
          if (j && j.output && typeof j.output === 'object') {
          // Best-effort validation of provided object
          function validateAndPrune(
            schema: any,
            value: any,
            path = '$'
          ): { value: any; errors: string[] } {
            const errors: string[] = [];
            if (!schema || typeof schema !== 'object') return { value, errors };
            const type = schema.type;
            if (type === 'object') {
              if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                errors.push(`${path}: expected object`);
                return { value, errors };
              }
              const props = schema.properties || {};
              const required: string[] = schema.required || Object.keys(props);
              const out: any = {};
              for (const k of Object.keys(props)) {
                const res = validateAndPrune(props[k], (value as any)[k], `${path}.${k}`);
                if ((value as any)[k] !== undefined) out[k] = res.value;
                errors.push(...res.errors);
              }
              for (const k of required) {
                if (out[k] === undefined) errors.push(`${path}: missing required '${k}'`);
              }
              return { value: out, errors };
            }
            if (type === 'array') {
              if (!Array.isArray(value)) {
                errors.push(`${path}: expected array`);
                return { value, errors };
              }
              const itemsSchema = schema.items || {};
              const arr: any[] = [];
              (value as any[]).forEach((v, i) => {
                const res = validateAndPrune(itemsSchema, v, `${path}[${i}]`);
                arr.push(res.value);
                errors.push(...res.errors);
              });
              return { value: arr, errors };
            }
            if (type === 'string') {
              if (typeof value !== 'string') {
                if (value == null) {
                  errors.push(`${path}: expected string`);
                } else {
                  value = String(value);
                }
              }
              return { value, errors };
            }
            if (type === 'number' || type === 'integer') {
              if (typeof value !== 'number') {
                const n = Number(value);
                if (!Number.isFinite(n)) errors.push(`${path}: expected number`);
                else value = n;
              }
              return { value, errors };
            }
            if (type === 'boolean') {
              if (typeof value !== 'boolean') {
                if (String(value).toLowerCase() === 'true') value = true;
                else if (String(value).toLowerCase() === 'false') value = false;
                else errors.push(`${path}: expected boolean`);
              }
              return { value, errors };
            }
            return { value, errors };
          }
            const { value, errors } = validateAndPrune(strictSchema, j.output);
            if (errors.length) {
              if (DEBUG) console.error('[LLM DEBUG] Validation errors:', errors);
              throw new Error(`LLM JSON failed schema validation: ${errors.join('; ')}`);
            }
            return value as T;
          }
          log.error(`LLM extractJSON '${schemaName}' attempt ${attempt} failed`, e);
          const backoff = 250 * Math.pow(2, attempt - 1);
          await sleep(backoff);
          if (attempt === 3) throw e;
        }
      }
      throw new Error('unreachable');
    },
  };
}
