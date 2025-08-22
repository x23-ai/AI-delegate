import type { FactCheckerAgent } from './types.js';
import type { FactCheckOutput } from '../types.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import type { DocChunk } from '../tools/x23.js';
import { evaluateExpression, nearlyEqual } from '../utils/math.js';
import { log } from '../utils/logger.js';
import { AVAILABLE_PROTOCOLS, AVAILABLE_ITEM_TYPES, DISCUSSION_URL } from '../utils/x23Config.js';
import { loadRolePrompt } from '../utils/roles.js';
import { SEARCH_TOOL_SELECTOR_SYSTEM_PROMPT, SEARCH_TOOL_SELECTOR_SCHEMA, SEED_SEARCH_SYSTEM_PROMPT, SEED_SEARCH_SCHEMA, RAW_POSTS_DECISION_PROMPT, RAW_POSTS_DECISION_SCHEMA } from '../tools/definitions.js';

// LLM prompts (editable)
const ASSUMPTION_EXTRACT_SYSTEM_SUFFIX =
  'You extract proposal assumptions. Distinguish the core proposal from supporting docs. Return JSON with proposalSummary, assumptions (claim, priority, type), and primarySources (URIs).';
const ARITHMETIC_EXTRACT_SYSTEM_SUFFIX =
  'Extract arithmetic checks from the proposal description and payload. Return JSON { checks: [{ title, description?, expression, claimedValue?, tolerance? }] }. Use numeric suffixes (k,M,B) and % of patterns where helpful.';
const CLAIM_CLASSIFY_SYSTEM_SUFFIX =
  'Classify whether the claim is supported, contested, or unknown given the evidence. Cite indices of evidence used. Return JSON { status, basis, citations:number[], confidence:number in [0,1] }.';

type ClaimStatus = 'supported' | 'contested' | 'unknown';

export const FactSleuth: FactCheckerAgent = {
  kind: 'factChecker',
  codename: 'Veritas Sleuth',
  systemPromptPath: 'src/agents/roles/fact-checker.md',
  async run(ctx): Promise<FactCheckOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const role = loadRolePrompt(FactSleuth.systemPromptPath);
    const sys = (s: string) => `${role}\n\n${s}`;
    // Derive a concise seed query via LLM (keyword-style, search-optimized)
    const seedPlan = await llm.extractJSON<{
      query: string;
      protocols?: string[];
    }>(
      sys(SEED_SEARCH_SYSTEM_PROMPT),
      `Title: ${ctx.proposal.title}\nDescription: ${ctx.proposal.description}\nPayloadDigest:\n${(ctx.proposal.payload || []).slice(0, 6).map((p, i) => `P${i+1} [${p.type}] ${p.uri || ''} :: ${JSON.stringify(p.data || p.metadata || {}).slice(0, 140)}`).join('\n') || '(none)'}\n`,
      SEED_SEARCH_SCHEMA as any,
      { schemaName: 'seedSearchPlan', maxOutputTokens: 200 }
    );

    const seedQuery = (seedPlan?.query && seedPlan.query.trim()) || ctx.proposal.title || `proposal ${ctx.proposal.id}`;
    const seedProtocols = Array.isArray(seedPlan?.protocols) && seedPlan!.protocols!.length
      ? seedPlan!.protocols!.filter((p) => AVAILABLE_PROTOCOLS.includes(p))
      : AVAILABLE_PROTOCOLS;

    // Seed searches to build an initial corpus
    log.info(`FactChecker: building corpus with seed query '${seedQuery}'`);
    const initialResults = await ctx.x23.hybridSearch({ query: seedQuery, topK: 12, protocols: seedProtocols });
    const official = await ctx.x23.officialHybridAnswer({ query: seedQuery, topK: 6, protocols: seedProtocols, realtime: false });

    // Trace the seed plan for auditability
    ctx.trace.addStep({
      type: 'analysis',
      description: 'Generated seed search plan',
      input: { title: ctx.proposal.title },
      output: { seedQuery, seedProtocols },
    });

    // Use any inline payload content as pseudo-docs
    const payloadDocs: DocChunk[] = (ctx.proposal.payload || [])
      .map((p, i) => {
        const text = typeof p.data === 'string' ? p.data : (p?.data?.text as string | undefined);
        if (text && typeof text === 'string' && text.trim()) {
          return {
            id: `payload-${i + 1}`,
            title: `[payload:${p.type}] ${p.uri || ''}`.trim(),
            uri: p.uri,
            snippet: text.slice(0, 800),
            source: 'payload',
            score: 1,
          } as DocChunk;
        }
        return undefined;
      })
      .filter(Boolean) as DocChunk[];

    const corpus: DocChunk[] = [...payloadDocs, ...initialResults, ...official.citations];

    // Summarize corpus for assumption extraction
    const corpusDigest = corpus
      .slice(0, 10)
      .map((d, i) => `#${i + 1} ${d.title || d.uri} :: ${d.snippet || ''} :: ${d.uri || ''}`)
      .join('\n');

    // Digest of provided payload (if any)
    const payloadDigest = (ctx.proposal.payload || [])
      .slice(0, 8)
      .map((p, i) => `P${i + 1}: [${p.type}] ${p.uri || ''} :: ${JSON.stringify(p.data || p.metadata || {}).slice(0, 160)}`)
      .join('\n');

    // Extract assumptions and primary sources
    log.info('FactChecker: extracting assumptions');
    const assumptionPack = await llm.extractJSON<{
      proposalSummary: string;
      assumptions: { claim: string; priority: 'high' | 'medium' | 'low'; type: string; evidenceHints?: string[] }[];
      primarySources: string[];
    }>(
      sys(ASSUMPTION_EXTRACT_SYSTEM_SUFFIX),
      `Title: ${ctx.proposal.title}\nDescription: ${ctx.proposal.description}\nProvidedPayload:\n${payloadDigest || '(none)'}\nCorpusDigest:\n${corpusDigest}`,
      {
        type: 'object',
        properties: {
          proposalSummary: { type: 'string' },
          assumptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                type: { type: 'string' },
                evidenceHints: { type: 'array', items: { type: 'string' } },
              },
              required: ['claim', 'priority', 'type'],
            },
          },
          primarySources: { type: 'array', items: { type: 'string' } },
        },
        required: ['proposalSummary', 'assumptions'],
      },
      { schemaName: 'assumptionPack', maxOutputTokens: 8000 }
    );

    ctx.trace.addStep({
      type: 'factCheck',
      description: 'Extracted assumptions and primary sources',
      input: { title: ctx.proposal.title, desc: ctx.proposal.description },
      output: assumptionPack,
      references: corpus.slice(0, 5).map((d) => ({ source: d.source || 'search', uri: d.uri || '' })),
    });

    // Helper: LLM tool selection
    async function pickSearchTool(claim: string, hints?: string[]) {
      return llm.extractJSON<{
        tool: 'officialHybrid' | 'hybrid' | 'vector' | 'keyword';
        query: string;
        limit?: number;
        similarityThreshold?: number;
        protocols?: string[];
        itemTypes?: string[];
        realtime?: boolean;
      }>(
        sys(SEARCH_TOOL_SELECTOR_SYSTEM_PROMPT),
        `Claim: ${claim}\nHints: ${JSON.stringify(hints || [])}\nSeedTitle: ${ctx.proposal.title}\nProvidedPayload:\n${payloadDigest || '(none)'}`,
        SEARCH_TOOL_SELECTOR_SCHEMA as any,
        { schemaName: 'searchToolPlan', maxOutputTokens: 1200 }
      );
    }

    // Helper: Sanitize tool plan values to meet API constraints
    function sanitizeToolPlan(plan: any) {
      const sanitized: any = { ...plan };
      // Normalize protocols to allowed list
      const reqProt = Array.isArray(plan.protocols) ? plan.protocols : [];
      const normProt = reqProt
        .map((p: string) => (typeof p === 'string' ? p.trim().toLowerCase() : ''))
        .filter(Boolean);
      const filteredProt = normProt.filter((p: string) => AVAILABLE_PROTOCOLS.includes(p));
      if (filteredProt.length) sanitized.protocols = filteredProt;
      else delete sanitized.protocols; // let defaults apply

      // Normalize itemTypes
      const reqTypes = Array.isArray(plan.itemTypes) ? plan.itemTypes : [];
      const filteredTypes = reqTypes.filter((t: string) => AVAILABLE_ITEM_TYPES.includes(t));
      if (filteredTypes.length) sanitized.itemTypes = filteredTypes; else delete sanitized.itemTypes;

      // rawPosts: enforce discussionUrl root and extract topicId from URL if provided
      if (plan.tool === 'rawPosts' && plan.rawPosts) {
        const rp = { ...plan.rawPosts };
        // If a full topic URL is provided, attempt to extract topicId (last numeric segment)
        if (typeof rp.topicId === 'string' && rp.topicId.includes('/')) {
          const parts = rp.topicId.split('/');
          const last = parts.filter(Boolean).pop() || '';
          if (/^\d+$/.test(last)) rp.topicId = last;
        }
        if (typeof rp.discussionUrl !== 'string' || !rp.discussionUrl.startsWith(DISCUSSION_URL)) {
          rp.discussionUrl = DISCUSSION_URL;
        } else {
          // Coerce to root domain only
          rp.discussionUrl = DISCUSSION_URL;
        }
        sanitized.rawPosts = rp;
      }

      // Do not alter LLM-provided query; rely on prompt instructions for concision
      return sanitized;
    }

    // Helper: Execute tool plan
    async function runSearchTool(plan: Awaited<ReturnType<typeof pickSearchTool>>) {
      // Sanitize before use
      plan = sanitizeToolPlan(plan) as any;
      const topK = plan.limit ?? 6;
      // Apply defaults and constraints
      const requestedProtocols = plan.protocols || [];
      const filteredProtocols = requestedProtocols.filter((p) => AVAILABLE_PROTOCOLS.includes(p));
      const protocols = filteredProtocols.length ? filteredProtocols : AVAILABLE_PROTOCOLS;
      const itemTypes = (plan.itemTypes || []).filter((t) => AVAILABLE_ITEM_TYPES.includes(t));
      const safeItemTypes = itemTypes.length ? itemTypes : undefined;
      if (plan.tool === 'officialHybrid') {
        const realtime = plan.realtime === true;
        log.info(`FactChecker: officialHybrid realtime=${realtime}`);
        let spinner: { stop: (msg?: string) => void } | undefined;
        if (realtime) spinner = log.spinner('x23 officialHybrid realtime');
        try {
          const ans = await ctx.x23.officialHybridAnswer({ query: plan.query, topK, protocols, similarityThreshold: plan.similarityThreshold, realtime });
          return { docs: ans.citations, answer: ans.answer };
        } finally {
          spinner?.stop('officialHybrid completed');
        }
      }
      if (plan.tool === 'hybrid') {
        const docs = await ctx.x23.hybridSearch({ query: plan.query, topK, protocols, itemTypes: safeItemTypes, similarityThreshold: plan.similarityThreshold });
        return { docs };
      }
      if (plan.tool === 'vector') {
        const docs = await ctx.x23.vectorSearch({ query: plan.query, topK, protocols, itemTypes: safeItemTypes, similarityThreshold: plan.similarityThreshold });
        return { docs };
      }
      if (plan.tool === 'keyword') {
        const docs = await ctx.x23.keywordSearch({ query: plan.query, topK, protocols, itemTypes: safeItemTypes });
        return { docs };
      }
      return { docs: [] as DocChunk[] };
    }

    async function maybeExpandWithRawPosts(claim: string, docs: DocChunk[]) {
      try {
        // Provide top discussion-like doc to the LLM for decision
        const top = docs.find((d) => (d.source || '').toLowerCase().includes('discussion')) || docs[0];
        if (!top || !top.uri) return undefined;
        const decision = await llm.extractJSON<{
          useRawPosts: boolean; discussionUrl?: string; topicId?: string; minimumUnix?: number;
        }>(
          sys(RAW_POSTS_DECISION_PROMPT),
          `Claim: ${claim}\nDoc: ${JSON.stringify(top)}`,
          RAW_POSTS_DECISION_SCHEMA as any,
          { schemaName: 'rawPostsDecision', maxOutputTokens: 400 }
        );
        if (!decision.useRawPosts || !decision.topicId) return undefined;
        const discussionUrl = decision.discussionUrl || DISCUSSION_URL;
        const posts = await ctx.x23.getDiscussionPosts({ discussionUrl, topicId: decision.topicId, minimumUnix: decision.minimumUnix });
        const rawDoc: DocChunk = { id: `${decision.topicId}:raw`, title: 'Discussion raw posts', uri: discussionUrl, snippet: posts[0]?.body?.slice(0, 1200), source: 'discussion' };
        return rawDoc;
      } catch {
        return undefined;
      }
    }

    // Helper: Evaluate claim
    async function evalClaim(claim: string, docs: DocChunk[], answerHint?: string) {
      // Always include a small slice of inline payload docs (if any) to aid classification
      const docsWithPayload = [...payloadDocs.slice(0, 2), ...docs];
      const evidenceList = docsWithPayload.slice(0, 8).map((d, i) => ({ idx: i + 1, title: d.title, uri: d.uri, snippet: d.snippet }));
      const classification = await llm.extractJSON<{ status: ClaimStatus; basis: string; citations: number[]; confidence: number }>(
        sys(CLAIM_CLASSIFY_SYSTEM_SUFFIX),
        `Claim: ${claim}\nAnswerHint: ${answerHint || ''}\nEvidence:\n${evidenceList.map((e) => `[#${e.idx}] ${e.title} :: ${e.uri} :: ${e.snippet}`).join('\n')}`,
        {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['supported', 'contested', 'unknown'] },
            basis: { type: 'string' },
            citations: { type: 'array', items: { type: 'number' } },
            confidence: { type: 'number' },
          },
          required: ['status', 'citations', 'confidence'],
        },
        { schemaName: 'claimEval', maxOutputTokens: 1600 }
      );
      const chosenUris = classification.citations
        .map((i) => evidenceList.find((e) => e.idx === i)?.uri)
        .filter(Boolean) as string[];
      return { status: classification.status as ClaimStatus, basis: classification.basis, uris: chosenUris, confidence: classification.confidence };
    }

    // Claims accumulator
    const claims: FactCheckOutput['claims'] = [];

    // Arithmetic checks extraction and evaluation (before assumptions loop)
    log.info('FactChecker: extracting arithmetic checks');
    try {
      const arithmeticPlan = await llm.extractJSON<{
        checks: Array<{
          title: string;
          description?: string;
          expression: string; // e.g., "5% of 200 + 1.2M"
          claimedValue?: number; // optional claimed value to verify against
          tolerance?: number; // optional absolute tolerance
        }>;
      }>(
        sys(ARITHMETIC_EXTRACT_SYSTEM_SUFFIX),
        `Title: ${ctx.proposal.title}\nDescription: ${ctx.proposal.description}\nProvidedPayload:\n${payloadDigest || '(none)'}\nCorpusDigest:\n${corpusDigest}`,
        {
          type: 'object',
          properties: {
            checks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  expression: { type: 'string' },
                  claimedValue: { type: 'number' },
                  tolerance: { type: 'number' },
                },
                required: ['title', 'expression'],
              },
            },
          },
          required: ['checks'],
        },
        { schemaName: 'arithmeticPlan', maxOutputTokens: 3000 }
      );

      if (arithmeticPlan?.checks?.length) {
        log.info(`FactChecker: evaluating ${arithmeticPlan.checks.length} arithmetic checks`);
        for (const chk of arithmeticPlan.checks) {
          try {
            const value = evaluateExpression(chk.expression);
            let status: ClaimStatus = 'supported';
            if (typeof chk.claimedValue === 'number') {
              const ok = nearlyEqual(value, chk.claimedValue, 1e-6, chk.tolerance ?? 1e-6);
              status = ok ? 'supported' : 'contested';
            }
            const claimText = `Arithmetic: ${chk.title} => ${value}${typeof chk.claimedValue === 'number' ? ` (claimed ${chk.claimedValue})` : ''}`;
            claims.push({ claim: claimText, status, citations: [], confidence: 0.9 });
            ctx.trace.addStep({ type: 'factCheck', description: `Arithmetic check: ${chk.title}`, input: chk, output: { value, status } });
          } catch (e) {
            const claimText = `Arithmetic: ${chk.title} (failed to evaluate)`;
            claims.push({ claim: claimText, status: 'unknown', citations: [], confidence: 0.3 });
            ctx.trace.addStep({ type: 'factCheck', description: `Arithmetic check failed: ${chk.title}`, input: chk, output: { error: String(e) } });
          }
        }
      }
    } catch (e) {
      // Non-fatal if arithmetic extraction fails
      ctx.trace.addStep({ type: 'analysis', description: 'Arithmetic extraction failed', output: { error: String(e) } });
    }

    // Iterate over assumptions and fact-check with refinement
    const usedUris = new Set<string>();
    const maxFactIters = Number(process.env.FACT_MAX_ITERS || 2);
    const minCitations = Number(process.env.FACT_MIN_CITATIONS || 1);
    const minConfidence = Number(process.env.FACT_MIN_CONFIDENCE || 0.6);
    log.info(`FactChecker: evaluating ${assumptionPack.assumptions?.length || 0} assumptions`);
    const totalFacts = assumptionPack.assumptions?.length || 0;
    let idxFact = 0;
    for (const a of assumptionPack.assumptions || []) {
      idxFact++;
      log.info(`FactChecker: [${idxFact}/${totalFacts}] evaluating assumption '${a.claim}'`);
      let finalStatus: ClaimStatus = 'unknown';
      let finalCitations: string[] = [];
      let finalBasis = '';
      let finalConfidence = 0;
      const tried: any[] = [];

      for (let iter = 0; iter < maxFactIters; iter++) {
        const plan = await llm.extractJSON<Awaited<ReturnType<typeof pickSearchTool>>>(
          [
            'Select the best single tool and parameters to retrieve evidence. Prefer official docs first.',
            '- For keyword/vector/hybrid: output a short, concise keyword query (<= 10 words), optimized for search engines.',
            '- For officialHybrid realtime=true: natural-language question allowed. Otherwise, use concise keyword-style (<= 10 words).',
            `- Available protocols: ${AVAILABLE_PROTOCOLS.join(', ')} (default to these if unset).`,
            `- Allowed itemTypes: ${AVAILABLE_ITEM_TYPES.join(', ')} (subset as needed).`,
            'Avoid repeating prior failed plans. Return JSON.',
          ].join('\n'),
          `Claim: ${a.claim}\nHints: ${JSON.stringify(a.evidenceHints || [])}\nProvidedPayload:\n${payloadDigest || '(none)'}\nPreviouslyTried: ${JSON.stringify(tried)}`,
          SEARCH_TOOL_SELECTOR_SCHEMA as any,
          { schemaName: 'searchToolPlan', maxOutputTokens: 1200 }
        );
        tried.push({ tool: (plan as any).tool, query: (plan as any).query });
        log.info(`FactChecker: [${idxFact}/${totalFacts}] tool '${(plan as any).tool}' for claim '${a.claim}'`);
        const exec = await runSearchTool(plan as any);
        // Optionally expand with raw posts if needed
        const rawDoc = await maybeExpandWithRawPosts(a.claim, exec.docs);
        const docsForEval = rawDoc ? [rawDoc, ...exec.docs] : exec.docs;
        log.info(`FactChecker: tool returned ${exec.docs?.length || 0} docs`);
        const outcome = await evalClaim(a.claim, docsForEval, exec.answer);
        log.info(`FactChecker: classification => ${outcome.status} (confidence=${outcome.confidence ?? 'n/a'})`);

        // Trace this iteration
        ctx.trace.addStep({
          type: 'factCheck',
          description: `Fact-checked assumption (iter ${iter + 1}): ${a.claim}`,
          input: { toolPlan: plan },
          output: { status: outcome.status, basis: outcome.basis, confidence: outcome.confidence },
          references: exec.docs.slice(0, 5).map((d) => ({ source: d.source || 'search', uri: d.uri || '' })),
        });

        finalStatus = outcome.status;
        finalCitations = outcome.uris;
        finalBasis = outcome.basis || finalBasis;
        finalConfidence = typeof outcome.confidence === 'number' ? outcome.confidence : finalConfidence;

        const enoughEvidence = finalCitations.length >= minCitations;
        const confidentEnough = finalConfidence >= minConfidence;
        if (finalStatus !== 'unknown' && enoughEvidence && confidentEnough) break;
      }

      claims.push({ claim: a.claim, status: finalStatus, citations: finalCitations, confidence: finalConfidence });
      finalCitations.forEach((u) => usedUris.add(u));
    }

    // Compute aggregate confidence across claims (simple average of provided confidences)
    const confidences = claims.map((c) => (typeof c.confidence === 'number' ? c.confidence : 0.5));
    const overallConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0.5;

    return { claims, keyEvidence: Array.from(usedUris), overallConfidence };
  },
};
