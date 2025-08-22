import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { PlannerAgent } from './types.js';
import type { PlanningOutput } from '../types.js';
import { loadRolePrompt } from '../utils/roles.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import { applyPromptTemplate } from '../utils/prompt.js';
import { AVAILABLE_PROTOCOLS, DISCUSSION_URL } from '../utils/x23Config.js';
import { planSeedSearch } from '../tools/evidence.js';
import { SchemaNames, TraceLabels } from './constants.js';

// LLM prompts (editable)
const PLANNER_PROMPT_SYSTEM_SUFFIX =
  'Design a concise plan (objectives and ordered tasks) to evaluate this proposal effectively. Include assumptions and risks if relevant.';

export const PlannerNavigator: PlannerAgent = {
  kind: 'planner',
  codename: 'Navigator Cartographer',
  systemPromptPath: resolve('src/agents/roles/planner.md'),
  async run(ctx): Promise<PlanningOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const baseRole = loadRolePrompt(PlannerNavigator.systemPromptPath);
    const role = applyPromptTemplate(baseRole, { protocols: AVAILABLE_PROTOCOLS.join(', '), forumRoot: DISCUSSION_URL });
    const payloadDigest = (ctx.proposal.payload || [])
      .slice(0, 8)
      .map((p, i) => `P${i + 1}: [${p.type}] ${p.uri || ''}`)
      .join('\n');
    const schemaName = SchemaNames.planner();
    const traceLabel = TraceLabels.planner();
    const plan = await llm.extractJSON<PlanningOutput>(
      `${role}\n\n${PLANNER_PROMPT_SYSTEM_SUFFIX}`,
      `Title: ${ctx.proposal.title}\nDescription: ${ctx.proposal.description}\nPayload:\n${payloadDigest || '(none)'}\n`,
      {
        type: 'object',
        properties: {
          objectives: { type: 'array', items: { type: 'string' } },
          tasks: { type: 'array', items: { type: 'string' } },
          assumptions: { type: 'array', items: { type: 'string' } },
          risks: { type: 'array', items: { type: 'string' } },
        },
        required: ['objectives', 'tasks'],
      },
      { schemaName, maxOutputTokens: 3000 }
    );
    const objectives = plan.objectives || [];
    const tasks = plan.tasks || [];

    // Bootstrap context with a seed search plan and record it; add a planning task if missing
    try {
      const seed = await planSeedSearch(ctx, llm, role);
      const seedQuery = (seed?.query || '').trim();
      const seedProtocols = (seed?.protocols || AVAILABLE_PROTOCOLS).filter((p) => AVAILABLE_PROTOCOLS.includes(p));
      if (seedQuery) {
        const taskLine = `Seed search corpus: "${seedQuery}" [${seedProtocols.join(', ')}]`;
        if (!tasks.some((t) => t.toLowerCase().includes('seed search'))) tasks.unshift(taskLine);
        ctx.trace.addStep({
          type: 'planning',
          description: 'Planner seed search plan',
          input: { title: ctx.proposal.title },
          output: { seedQuery, seedProtocols },
        });
      }
    } catch {}

    const refs = (ctx.proposal.payload || [])
      .filter((p) => !!p.uri)
      .slice(0, 5)
      .map((p) => ({ source: p.type || 'payload', uri: p.uri! }));
    ctx.trace.addStep({
      type: 'planning',
      description: traceLabel,
      output: { objectives, tasks },
      references: refs,
    });

    return { objectives, tasks, assumptions: plan.assumptions || [], risks: plan.risks || [] };
  },
};
