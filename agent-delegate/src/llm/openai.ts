import type { LLMClient, LLMGenerateOptions, LLMExtractOptions } from './types.js';
import { log, sleep, colors } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

function getDebugLevel(): number {
  const d = String(process.env.DEBUG || '').trim().toLowerCase();
  if (d === '1' || d === 'true' || d === 'yes') return 1;
  const lvl = Number(process.env.DEBUG_LEVEL || '0');
  return Number.isFinite(lvl) ? Math.max(0, Math.min(3, lvl)) : 0;
}
const DEBUG_LEVEL = getDebugLevel();

interface OpenAIConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string; // default https://api.openai.com/v1
}

export function createOpenAIClient(config: OpenAIConfig = {}): LLMClient {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  const model = config.model || process.env.OPENAI_MODEL || 'gpt-5-mini';
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const DEBUG = (() => {
    const v = String(process.env.DEBUG || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  })();

  const isReasoningModel = /(^gpt5|^gpt-5)/i.test(model) || /gpt-5-mini/i.test(model);

  function resolveModelOverride(opts?: LLMGenerateOptions | LLMExtractOptions): string | undefined {
    const diff = (opts as any)?.difficulty as 'easy' | 'normal' | 'hard' | undefined;
    const override = (opts as any)?.model as string | undefined;
    if (override) return override;
    if (!diff) return undefined;
    const M_EASY = process.env.OPENAI_MODEL_EASY || 'gpt-5-nano';
    const M_NORMAL = process.env.OPENAI_MODEL_NORMAL || 'gpt-5-mini';
    const M_HARD = process.env.OPENAI_MODEL_HARD || 'gpt-5';
    return diff === 'easy' ? M_EASY : diff === 'hard' ? M_HARD : M_NORMAL;
  }

  async function callResponses(body: any, modelOverride?: string): Promise<any> {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI provider');
    const mdl = modelOverride || model;
    const spinner = log.spinner(`LLM ${mdl} responses`);
    const start = Date.now();
    const res = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: mdl, ...body }),
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      spinner.stop(`${colors.red('✗')} LLM responses error ${colors.dim(`(${ms}ms)`)}`);
      log.error(`${colors.cyan('LLM response')} ${colors.red('✗')} ${colors.dim(`(${ms}ms)`)} ${colors.red(String(res.status))}`);
      throw new Error(`OpenAI Responses error ${res.status}: ${text}`);
    }
    spinner.stop();
    return await res.json();
  }

  function approxTokensFromText(s: string): number {
    if (!s) return 0;
    // Rough heuristic: ~4 chars per token
    return Math.max(1, Math.round(s.length / 4));
  }

  function logTokenUsage(label: string, json: any, inputStrs: string[], extraSchema?: object) {
    try {
      const u = (json as any)?.usage || (json as any)?.response?.usage || undefined;
      let inputTokens = u?.input_tokens ?? u?.prompt_tokens ?? u?.input?.tokens;
      let outputTokens = u?.output_tokens ?? u?.completion_tokens ?? u?.output?.tokens;
      let totalTokens = u?.total_tokens ?? (typeof inputTokens === 'number' && typeof outputTokens === 'number' ? inputTokens + outputTokens : undefined);
      let est = false;
      if (typeof inputTokens !== 'number') {
        const inputsJoined = inputStrs.filter(Boolean).join('\n');
        let approx = approxTokensFromText(inputsJoined);
        if (extraSchema) {
          try { approx += approxTokensFromText(JSON.stringify(extraSchema)); } catch {}
        }
        inputTokens = approx;
        est = true;
      }
      if (typeof outputTokens !== 'number') {
        // If model didn't return usage, we cannot know completion size here reliably
        outputTokens = 0;
        est = true;
      }
      if (typeof totalTokens !== 'number') totalTokens = (inputTokens || 0) + (outputTokens || 0);
      log.info(`LLM tokens ${label}: input=${inputTokens} output=${outputTokens} total=${totalTokens}${est ? ' (est)' : ''}`);
      metrics.recordLLMUsage(inputTokens, outputTokens);
    } catch {}
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
      const modelOverride = resolveModelOverride(opts);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const maxTokens = Math.min(Math.floor(baseMax * Math.pow(1.5, attempt - 1)), 16000);
        const body: any = {
          input: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          max_output_tokens: maxTokens,
          top_p: 1,
        };
        log.info(`LLM text generation attempt ${attempt} (max_tokens=${maxTokens}) …`);
        try {
          const json = await callResponses(body, modelOverride);
          logTokenUsage(`text:${modelOverride || model}`, json, [system, prompt]);
          if (DEBUG) {
            try {
              console.log('[DEBUG] LLM raw JSON (generateText):');
              console.log(JSON.stringify(json, null, 2));
            } catch {}
          }
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
      if (DEBUG_LEVEL >= 1) {
        try { log.debug(`LLM schema '${schemaName}'`, strictSchema as any); } catch {}
      }
      const baseMax = opts?.maxOutputTokens ?? 4000;
      const modelOverride = resolveModelOverride(opts);
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
          top_p: 1,
        } as any;
        log.info(`LLM step '${schemaName}' attempt ${attempt} (max_tokens=${maxTokens}) …`);
        try {
          const json = await callResponses(body, modelOverride);
          logTokenUsage(`step:${schemaName}:${modelOverride || model}`, json, [system, prompt], strictSchema);
          if (DEBUG_LEVEL >= 1) {
            try { log.debug('LLM raw JSON', json); } catch {}
          }
          const text = pickOutputText(json);
          if (DEBUG_LEVEL >= 2) {
            try { log.debug('LLM raw text', { text }); } catch {}
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
            if (DEBUG_LEVEL >= 1) log.debug('LLM validation errors', errors);
            throw new Error(`LLM JSON failed schema validation: ${errors.join('; ')}`);
          }
          if (DEBUG_LEVEL >= 1) {
            try { log.debug(`LLM parsed object (${schemaName})`, value as any); } catch {}
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
              if (DEBUG_LEVEL >= 1) log.debug('LLM validation errors', errors);
              throw new Error(`LLM JSON failed schema validation: ${errors.join('; ')}`);
            }
            if (DEBUG_LEVEL >= 1) {
              try { log.debug(`LLM parsed object (${schemaName}) from provider output`, value as any); } catch {}
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
