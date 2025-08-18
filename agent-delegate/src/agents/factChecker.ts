import type { FactCheckerAgent } from './types.js';
import type { FactCheckOutput } from '../types.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import type { DocChunk } from '../tools/x23.js';

type ClaimStatus = 'supported' | 'contested' | 'unknown';

export const FactSleuth: FactCheckerAgent = {
  kind: 'factChecker',
  codename: 'Veritas Sleuth',
  systemPromptPath: 'src/agents/roles/fact-checker.md',
  async run(ctx): Promise<FactCheckOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const seedQuery = ctx.proposal.title || `proposal ${ctx.proposal.id}`;

    // Seed searches to build an initial corpus
    const initialResults = await ctx.x23.hybridSearch({ query: seedQuery, topK: 12 });
    const official = await ctx.x23.officialHybridAnswer({ query: seedQuery, topK: 6 });

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
    const assumptionPack = await llm.extractJSON<{
      proposalSummary: string;
      assumptions: { claim: string; priority: 'high' | 'medium' | 'low'; type: string; evidenceHints?: string[] }[];
      primarySources: string[];
    }>(
      'You extract proposal assumptions. Distinguish the core proposal from supporting docs. Return JSON with proposalSummary, assumptions (claim, priority, type), and primarySources (URIs).',
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
      { schemaName: 'assumptionPack' }
    );

    ctx.trace.addStep({
      type: 'factCheck',
      description: 'Extracted assumptions and primary sources',
      input: { title: ctx.proposal.title, desc: ctx.proposal.description },
      output: assumptionPack,
      references: corpus.slice(0, 5).map((d) => ({ source: d.source || 'search', uri: d.uri || '' })),
    });

    // Helper: LLM tool selection
    async function pickTool(claim: string, hints?: string[]) {
      return llm.extractJSON<{
        tool: 'officialHybrid' | 'hybrid' | 'vector' | 'keyword' | 'rawPosts';
        query: string;
        limit?: number;
        similarityThreshold?: number;
        protocols?: string[];
        itemTypes?: string[];
        rawPosts?: { discussionUrl: string; topicId: string; minimumUnix?: number };
        realtime?: boolean;
      }>(
        'You are a tool selector for fact checking governance claims. Choose the best single tool and parameters to retrieve evidence that confirms or contests the claim. Prefer official docs first. Return JSON.',
        `Claim: ${claim}\nHints: ${JSON.stringify(hints || [])}\nSeedTitle: ${ctx.proposal.title}\nProvidedPayload:\n${payloadDigest || '(none)'}`,
        {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: ['officialHybrid', 'hybrid', 'vector', 'keyword', 'rawPosts'] },
            query: { type: 'string' },
            limit: { type: 'number' },
            similarityThreshold: { type: 'number' },
            protocols: { type: 'array', items: { type: 'string' } },
            itemTypes: { type: 'array', items: { type: 'string' } },
            realtime: { type: 'boolean' },
            rawPosts: {
              type: 'object',
              properties: {
                discussionUrl: { type: 'string' },
                topicId: { type: 'string' },
                minimumUnix: { type: 'number' },
              },
              required: ['discussionUrl', 'topicId'],
            },
          },
          required: ['tool', 'query'],
        },
        { schemaName: 'toolPlan' }
      );
    }

    // Helper: Execute tool plan
    async function runTool(plan: Awaited<ReturnType<typeof pickTool>>) {
      const topK = plan.limit ?? 6;
      if (plan.tool === 'officialHybrid') {
        const ans = await ctx.x23.officialHybridAnswer({ query: plan.query, topK, protocols: plan.protocols, similarityThreshold: plan.similarityThreshold, realtime: plan.realtime });
        return { docs: ans.citations, answer: ans.answer };
      }
      if (plan.tool === 'hybrid') {
        const docs = await ctx.x23.hybridSearch({ query: plan.query, topK, protocols: plan.protocols, itemTypes: plan.itemTypes, similarityThreshold: plan.similarityThreshold });
        return { docs };
      }
      if (plan.tool === 'vector') {
        const docs = await ctx.x23.vectorSearch({ query: plan.query, topK, protocols: plan.protocols, itemTypes: plan.itemTypes, similarityThreshold: plan.similarityThreshold });
        return { docs };
      }
      if (plan.tool === 'keyword') {
        const docs = await ctx.x23.keywordSearch({ query: plan.query, topK, protocols: plan.protocols, itemTypes: plan.itemTypes });
        return { docs };
      }
      if (plan.tool === 'rawPosts' && plan.rawPosts) {
        const posts = await ctx.x23.getDiscussionPosts(plan.rawPosts);
        // Represent raw posts as a pseudo DocChunk
        const doc: DocChunk = { id: plan.rawPosts.topicId, title: 'Discussion raw posts', uri: plan.rawPosts.discussionUrl, snippet: posts[0]?.body?.slice(0, 1000) };
        return { docs: [doc] };
      }
      return { docs: [] as DocChunk[] };
    }

    // Helper: Evaluate claim
    async function evalClaim(claim: string, docs: DocChunk[], answerHint?: string) {
      // Always include a small slice of inline payload docs (if any) to aid classification
      const docsWithPayload = [...payloadDocs.slice(0, 2), ...docs];
      const evidenceList = docsWithPayload.slice(0, 8).map((d, i) => ({ idx: i + 1, title: d.title, uri: d.uri, snippet: d.snippet }));
      const classification = await llm.extractJSON<{ status: ClaimStatus; basis: string; citations: number[]; confidence: number }>(
        'Classify whether the claim is supported, contested, or unknown given the evidence. Cite indices of evidence used. Return JSON { status, basis, citations:number[], confidence:number in [0,1] }.',
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
        { schemaName: 'claimEval' }
      );
      const chosenUris = classification.citations
        .map((i) => evidenceList.find((e) => e.idx === i)?.uri)
        .filter(Boolean) as string[];
      return { status: classification.status as ClaimStatus, basis: classification.basis, uris: chosenUris, confidence: classification.confidence };
    }

    // Iterate over assumptions and fact-check with refinement
    const claims: FactCheckOutput['claims'] = [];
    const usedUris = new Set<string>();
    const maxFactIters = Number(process.env.FACT_MAX_ITERS || 2);
    const minCitations = Number(process.env.FACT_MIN_CITATIONS || 1);
    const minConfidence = Number(process.env.FACT_MIN_CONFIDENCE || 0.6);
    for (const a of assumptionPack.assumptions || []) {
      let finalStatus: ClaimStatus = 'unknown';
      let finalCitations: string[] = [];
      let finalBasis = '';
      let finalConfidence = 0;
      const tried: any[] = [];

      for (let iter = 0; iter < maxFactIters; iter++) {
        const plan = await llm.extractJSON<Awaited<ReturnType<typeof pickTool>>>(
          'Select the best single tool and parameters to retrieve evidence. Prefer official docs first. Avoid repeating prior failed plans. Return JSON.',
        `Claim: ${a.claim}\nHints: ${JSON.stringify(a.evidenceHints || [])}\nProvidedPayload:\n${payloadDigest || '(none)'}\nPreviouslyTried: ${JSON.stringify(tried)}`,
          {
            type: 'object',
            properties: {
              tool: { type: 'string', enum: ['officialHybrid', 'hybrid', 'vector', 'keyword', 'rawPosts'] },
              query: { type: 'string' },
              limit: { type: 'number' },
              similarityThreshold: { type: 'number' },
              protocols: { type: 'array', items: { type: 'string' } },
              itemTypes: { type: 'array', items: { type: 'string' } },
              realtime: { type: 'boolean' },
              rawPosts: {
                type: 'object',
                properties: {
                  discussionUrl: { type: 'string' },
                  topicId: { type: 'string' },
                  minimumUnix: { type: 'number' },
                },
                required: ['discussionUrl', 'topicId'],
              },
            },
            required: ['tool', 'query'],
          },
          { schemaName: 'toolPlan' }
        );
        tried.push({ tool: (plan as any).tool, query: (plan as any).query });

        const exec = await runTool(plan as any);
        const outcome = await evalClaim(a.claim, exec.docs, exec.answer);

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
