import type { FactCheckerAgent } from './types.js';
import type { FactCheckOutput } from '../types.js';
import type { LLMClient } from '../llm/index.js';
import { createLLM } from '../llm/index.js';
import type { DocChunk } from '../tools/x23.js';
import { evaluateExpression, nearlyEqual } from '../utils/math.js';
import { log, colors } from '../utils/logger.js';
import { AVAILABLE_PROTOCOLS, AVAILABLE_ITEM_TYPES } from '../utils/x23Config.js';
import { loadRolePrompt } from '../utils/roles.js';
import {
  SEED_SEARCH_SYSTEM_PROMPT,
  SEED_SEARCH_SCHEMA,
} from '../tools/definitions.js';
import {
  selectSearchTool,
  runSearchTool,
  maybeExpandWithRawPosts,
  maybeExpandWithOfficialDetail,
} from '../tools/evidence.js';
import { applyPromptTemplate } from '../utils/prompt.js';
import { DISCUSSION_URL } from '../utils/x23Config.js';

// LLM prompts (editable)
const ASSUMPTION_EXTRACT_SYSTEM_SUFFIX =
  'You extract proposal assumptions. Distinguish the core proposal from supporting docs. Return JSON with proposalSummary, assumptions (claim, priority, type), and primarySources (URIs).';
const ARITHMETIC_EXTRACT_SYSTEM_SUFFIX =
  'Extract arithmetic checks from the proposal description and payload. Return JSON { checks: [{ title, description?, expression, claimedValue?, tolerance? }] }. Use numeric suffixes (k,M,B) and % of patterns where helpful.';
const CLAIM_CLASSIFY_SYSTEM_SUFFIX =
  'Classify whether the claim is supported, contested, or unknown given the evidence. Cite indices of evidence used. Return JSON { status, basis, citations:number[], confidence:number in [0,1] }.';

const ARITHMETIC_CONFIRM_SYSTEM_SUFFIX = [
  'You verify an arithmetic expression by rewriting it into an explicit numeric equation and computing the result.',
  '- Replace words/suffixes (k, M, B, million, billion, thousand), currency symbols, commas with numbers.',
  "- Convert constructs like 'X% of Y' to '(X/100)*Y' and 'bps' to '/10000'.",
  '- If APR with compounding is present, convert APR→APY only when explicitly indicated; otherwise treat % as a simple rate.',
  'Return JSON { equation: string, steps: string[], value: number }. Keep equation short (numbers and +-*/ only).',
].join('\n');

type ClaimStatus = 'supported' | 'contested' | 'unknown';

export const FactSleuth: FactCheckerAgent = {
  kind: 'factChecker',
  codename: 'Veritas Sleuth',
  systemPromptPath: 'src/agents/roles/fact-checker.md',
  async run(ctx): Promise<FactCheckOutput> {
    const llm: LLMClient = ctx.llm || createLLM();
    const baseRole = loadRolePrompt(FactSleuth.systemPromptPath);
    const role = applyPromptTemplate(baseRole, {
      protocols: AVAILABLE_PROTOCOLS.join(', '),
      forumRoot: DISCUSSION_URL,
    });
    const sys = (s: string) => `${role}\n\n${s}`;
    // Derive a concise seed query via LLM (keyword-style, search-optimized)
    const { planSeedSearch } = await import('../tools/evidence.js');
    const seedPlan = await planSeedSearch(ctx, llm, role);

    const seedQuery =
      (seedPlan?.query && seedPlan.query.trim()) ||
      ctx.proposal.title ||
      `proposal ${ctx.proposal.id}`;
    const seedProtocols =
      Array.isArray(seedPlan?.protocols) && seedPlan!.protocols!.length
        ? seedPlan!.protocols!.filter((p) => AVAILABLE_PROTOCOLS.includes(p))
        : AVAILABLE_PROTOCOLS;

    // Seed searches to build an initial corpus
    log.info(`FactChecker: building corpus with seed query '${seedQuery}'`);
    const initialResults = await ctx.x23.hybridSearch({
      query: seedQuery,
      topK: 12,
      protocols: seedProtocols,
    });

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

    const corpus: DocChunk[] = [...payloadDocs, ...initialResults];

    // Summarize corpus for assumption extraction
    const corpusDigest = corpus
      .slice(0, 10)
      .map((d, i) => `#${i + 1} ${d.title || d.uri} :: ${d.snippet || ''} :: ${d.uri || ''}`)
      .join('\n');

    // Digest of provided payload (if any)
    const payloadDigest = (ctx.proposal.payload || [])
      .slice(0, 8)
      .map(
        (p, i) =>
          `P${i + 1}: [${p.type}] ${p.uri || ''} :: ${JSON.stringify(p.data || p.metadata || {}).slice(0, 160)}`
      )
      .join('\n');

    // Extract assumptions and primary sources
    log.info('FactChecker: extracting assumptions');
    const assumptionPack = await llm.extractJSON<{
      proposalSummary: string;
      assumptions: {
        claim: string;
        priority: 'high' | 'medium' | 'low';
        type: string;
        evidenceHints?: string[];
      }[];
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
      references: corpus
        .slice(0, 5)
        .map((d) => ({ source: d.source || 'search', uri: d.uri || '' })),
    });

    // Evidence acquisition helpers moved to shared toolkit (evidence.ts)

    // Helper: Evaluate claim
    async function evalClaim(claim: string, docs: DocChunk[], answerHint?: string) {
      // Always include a small slice of inline payload docs (if any) to aid classification
      const docsWithPayload = [...payloadDocs.slice(0, 2), ...docs];
      const evidenceList = docsWithPayload
        .slice(0, 8)
        .map((d, i) => ({ idx: i + 1, title: d.title, uri: d.uri, snippet: d.snippet }));
      const classification = await llm.extractJSON<{
        status: ClaimStatus;
        basis: string;
        citations: number[];
        confidence: number;
      }>(
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
        { schemaName: 'claimEval', maxOutputTokens: 2600 }
      );
      const chosenUris = classification.citations
        .map((i) => evidenceList.find((e) => e.idx === i)?.uri)
        .filter(Boolean) as string[];
      return {
        status: classification.status as ClaimStatus,
        basis: classification.basis,
        uris: chosenUris,
        confidence: classification.confidence,
      };
    }

    // Claims accumulator
    const claims: FactCheckOutput['claims'] = [];

    // Arithmetic checks extraction and evaluation (before assumptions loop)
    log.info('FactChecker: extracting arithmetic checks');
    try {
      let arithSupported = 0;
      let arithContested = 0;
      let arithUnknown = 0;
      async function extractArithmetic(inputCtx: string) {
        return llm.extractJSON<{
        checks: Array<{
          title: string;
          description?: string;
          expression: string; // e.g., "5% of 200 + 1.2M"
          claimedValue?: number; // optional claimed value to verify against
          tolerance?: number; // optional absolute tolerance
        }>;
        }>(
          sys(ARITHMETIC_EXTRACT_SYSTEM_SUFFIX),
          inputCtx,
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
          { schemaName: 'arithmeticPlan', maxOutputTokens: 6000 }
        );
      }

      // First attempt: full context
      let arithmeticPlan = await extractArithmetic(
        `Title: ${ctx.proposal.title}\nDescription: ${ctx.proposal.description}\nProvidedPayload:\n${payloadDigest || '(none)'}\nCorpusDigest:\n${corpusDigest}`
      );

      // Fallback: title/description only if nothing found
      if (!arithmeticPlan?.checks?.length) {
        log.info('FactChecker: no arithmetic checks found; retrying with minimal context');
        arithmeticPlan = await extractArithmetic(
          `Title: ${ctx.proposal.title}\nDescription: ${ctx.proposal.description}`
        );
      }

      if (arithmeticPlan?.checks?.length) {
        const maxArith = Number(process.env.FACT_MAX_ARITH_CHECKS || 0);
        const arithChecks = maxArith > 0 ? arithmeticPlan.checks.slice(0, maxArith) : arithmeticPlan.checks;
        log.info(`FactChecker: evaluating ${arithChecks.length} arithmetic checks${maxArith > 0 ? ` (capped from ${arithmeticPlan.checks.length})` : ''}`);
        for (const chk of arithChecks) {
          try {
            const valueLocal = evaluateExpression(chk.expression);
            // Ask LLM to normalize and compute as an independent check
            const confirm = await llm.extractJSON<{ equation: string; steps?: string[]; value: number }>(
              sys(ARITHMETIC_CONFIRM_SYSTEM_SUFFIX),
              `Title: ${chk.title}\nExpression: ${chk.expression}\n${typeof chk.claimedValue === 'number' ? `ClaimedValue: ${chk.claimedValue}\nTolerance: ${chk.tolerance ?? ''}` : ''}`,
              {
                type: 'object',
                properties: {
                  equation: { type: 'string' },
                  steps: { type: 'array', items: { type: 'string' } },
                  value: { type: 'number' },
                },
                required: ['equation', 'value'],
              },
              { schemaName: 'arithConfirm', maxOutputTokens: 1200 }
            );
            const valueLLM = typeof confirm?.value === 'number' ? confirm.value : valueLocal;
            const value = Number.isFinite(valueLLM) ? valueLLM : valueLocal;
            let status: ClaimStatus = 'supported';
            let confidence = 0.9;
            let note = '';
            if (typeof chk.claimedValue === 'number') {
              const ok = nearlyEqual(value, chk.claimedValue, 1e-6, chk.tolerance ?? 1e-6);
              status = ok ? 'supported' : 'contested';
              confidence = ok ? 0.95 : 0.6;
              note = ok ? 'LLM-confirmed' : 'LLM/local mismatch with claimed';
            } else {
              // No claimed value; use LLM+local agreement to adjust confidence
              const agree = nearlyEqual(valueLLM, valueLocal, 1e-6, 1e-6);
              confidence = agree ? 0.9 : 0.7;
              note = agree ? 'LLM agrees' : 'LLM differs slightly';
            }
            const claimText = `Arithmetic: ${chk.title} => ${value}${typeof chk.claimedValue === 'number' ? ` (claimed ${chk.claimedValue})` : ''}`;
            claims.push({ claim: claimText, status, citations: [], confidence });
            if (status === 'supported') arithSupported++;
            else if (status === 'contested') arithContested++;
            else arithUnknown++;
            ctx.trace.addStep({
              type: 'factCheck',
              description: `Arithmetic check: ${chk.title}`,
              input: chk,
              output: { valueLocal: valueLocal, valueLLM: valueLLM, finalValue: value, equation: confirm?.equation, status, note },
            });
          } catch (e) {
            const claimText = `Arithmetic: ${chk.title} (failed to evaluate)`;
            claims.push({ claim: claimText, status: 'unknown', citations: [], confidence: 0.3 });
            arithUnknown++;
            ctx.trace.addStep({
              type: 'factCheck',
              description: `Arithmetic check failed: ${chk.title}`,
              input: chk,
              output: { error: String(e) },
            });
          }
        }
        const arithTotal = arithSupported + arithContested + arithUnknown;
        log.info(
          `FactChecker: arithmetic summary — total=${arithTotal} supported=${arithSupported} contested=${arithContested} unknown=${arithUnknown}`
        );
        // Stash arithmetic summary in cache for return
        (ctx.cache ?? (ctx.cache = new Map())).set('arithSummary', {
          total: arithTotal,
          supported: arithSupported,
          contested: arithContested,
          unknown: arithUnknown,
        });
      } else {
        log.info('FactChecker: no arithmetic checks identified');
        (ctx.cache ?? (ctx.cache = new Map())).set('arithSummary', {
          total: 0,
          supported: 0,
          contested: 0,
          unknown: 0,
        });
      }
    } catch (e) {
      // Non-fatal if arithmetic extraction fails
      ctx.trace.addStep({
        type: 'analysis',
        description: 'Arithmetic extraction failed',
        output: { error: String(e) },
      });
    }

    // Iterate over assumptions and fact-check with refinement
    const usedUris = new Set<string>();
    const maxFactIters = Number(process.env.FACT_MAX_ITERS || 2);
    const minCitations = Number(process.env.FACT_MIN_CITATIONS || 1);
    const minConfidence = Number(process.env.FACT_MIN_CONFIDENCE || 0.6);
    const maxChecks = Number(process.env.FACT_MAX_CHECKS || 0);
    const allAssumptions = assumptionPack.assumptions || [];
    const selectedAssumptions = maxChecks > 0 ? allAssumptions.slice(0, maxChecks) : allAssumptions;
    log.info(`FactChecker: evaluating ${selectedAssumptions.length} assumptions`);
    const totalFacts = selectedAssumptions.length;
    let idxFact = 0;
    for (const a of selectedAssumptions) {
      idxFact++;
      log.info(`FactChecker: [${idxFact}/${totalFacts}] evaluating assumption '${a.claim}'`);
      let finalStatus: ClaimStatus = 'unknown';
      let finalCitations: string[] = [];
      let finalBasis = '';
      let finalConfidence = 0;
      const tried: any[] = [];

      let zeroDocStreak = 0;
      for (let iter = 0; iter < maxFactIters; iter++) {
        const plan = await selectSearchTool(ctx, llm, {
          rolePrompt: role,
          claimOrQuery: a.claim,
          hints: a.evidenceHints || [],
          payloadDigest,
          previouslyTried: tried,
        });
        tried.push({ tool: (plan as any).tool, query: (plan as any).query });
        log.info(
          `FactChecker: [${idxFact}/${totalFacts}] tool '${(plan as any).tool}' for claim '${a.claim}'`
        );
        const exec = await runSearchTool(ctx, plan as any, a.claim);
        // Optionally expand with raw posts if needed
        const rawDoc = await maybeExpandWithRawPosts(ctx, llm, role, a.claim, exec.docs);
        const offDoc = await maybeExpandWithOfficialDetail(ctx, llm, role, a.claim, exec.docs);
        const docsForEval = [rawDoc, offDoc].filter(Boolean).concat(exec.docs) as DocChunk[];
        const retCount = exec.docs?.length || 0;
        log.info(`FactChecker: tool returned ${retCount} docs`);
        tried.push({
          tool: (plan as any).tool,
          query: (plan as any).query,
          limit: (plan as any).limit,
          similarityThreshold: (plan as any).similarityThreshold,
          protocols: (plan as any).protocols,
          itemTypes: (plan as any).itemTypes,
          resultCount: retCount,
        });
        if (Array.isArray((exec as any).attempts)) {
          for (const att of (exec as any).attempts) tried.push(att);
        }
        if (retCount === 0) {
          zeroDocStreak++;
          if (zeroDocStreak >= Math.max(2, Math.min(3, maxFactIters - iter - 1))) {
            log.info('FactChecker: no results after multiple attempts; moving on');
            break;
          }
          continue; // try again with adjusted plan
        }
        const outcome = await evalClaim(a.claim, docsForEval, (exec as any).answer);
        const basisFull = (outcome.basis || '').toString();
        log.info(
          `FactChecker: classification => ${outcome.status} (confidence=${outcome.confidence ?? 'n/a'}); basis: ${basisFull}`
        );

        // Trace this iteration
        ctx.trace.addStep({
          type: 'factCheck',
          description: `Fact-checked assumption (iter ${iter + 1}): ${a.claim}`,
          input: { toolPlan: plan },
          output: { status: outcome.status, basis: outcome.basis, confidence: outcome.confidence },
          references: exec.docs
            .slice(0, 5)
            .map((d) => ({ source: d.source || 'search', uri: d.uri || '' })),
        });

        finalStatus = outcome.status;
        finalCitations = outcome.uris;
        finalBasis = outcome.basis || finalBasis;
        finalConfidence =
          typeof outcome.confidence === 'number' ? outcome.confidence : finalConfidence;

        const enoughEvidence = finalCitations.length >= minCitations;
        const confidentEnough = finalConfidence >= minConfidence;
        if (finalStatus !== 'unknown' && enoughEvidence && confidentEnough) break;
      }

      try {
        const cites =
          finalCitations && finalCitations.length ? finalCitations.join(', ') : '(none)';
        const confDisp = typeof finalConfidence === 'number' ? finalConfidence.toFixed(2) : 'n/a';
        log.info(
          `FactChecker: FINAL => ${colors.bold(finalStatus)} — ${a.claim} | confidence=${confDisp} | citations=${cites}`
        );
      } catch {}
      claims.push({
        claim: a.claim,
        status: finalStatus,
        citations: finalCitations,
        confidence: finalConfidence,
      });
      finalCitations.forEach((u) => usedUris.add(u));
    }

    // Compute aggregate confidence across claims (simple average of provided confidences)
    const confidences = claims.map((c) => (typeof c.confidence === 'number' ? c.confidence : 0.5));
    const overallConfidence = confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0.5;

    // Final summary for fact checks (excluding arithmetic-only claims)
    try {
      const nonArith = claims.filter((c) => !c.claim.startsWith('Arithmetic:'));
      const nTotal = nonArith.length;
      const nSup = nonArith.filter((c) => c.status === 'supported').length;
      const nCon = nonArith.filter((c) => c.status === 'contested').length;
      const nUnk = nonArith.filter((c) => c.status === 'unknown').length;
      const avgConfNum =
        nTotal > 0
          ? nonArith
              .map((c) => (typeof c.confidence === 'number' ? c.confidence : 0))
              .reduce((a, b) => a + b, 0) / nTotal
          : undefined;
      const avgConf = typeof avgConfNum === 'number' ? avgConfNum.toFixed(2) : 'n/a';
      log.info(
        `FactChecker: summary — assumptions=${nTotal} supported=${nSup} contested=${nCon} unknown=${nUnk} avgConfidence=${avgConf}`
      );
      (ctx.cache ?? (ctx.cache = new Map())).set('assumSummary', {
        total: nTotal,
        supported: nSup,
        contested: nCon,
        unknown: nUnk,
        avgConfidence: avgConfNum,
      });
    } catch {}

    const arithmeticSummary = (ctx.cache?.get('arithSummary') as any) || undefined;
    const assumptionsSummary = (ctx.cache?.get('assumSummary') as any) || undefined;
    return { claims, keyEvidence: Array.from(usedUris), overallConfidence, arithmeticSummary, assumptionsSummary };
  },
};
