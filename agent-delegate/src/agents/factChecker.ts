import type { FactCheckerAgent } from './types.js';
import type { FactCheckOutput } from '../types.js';

export const FactSleuth: FactCheckerAgent = {
  kind: 'factChecker',
  codename: 'Veritas Sleuth',
  systemPromptPath: 'src/agents/roles/fact-checker.md',
  async run(ctx): Promise<FactCheckOutput> {
    // Scaffold: suggest queries and leave stubs
    const seedQuery = ctx.proposal.title || `proposal ${ctx.proposal.id}`;
    const results = await ctx.x23.hybridSearch({ query: seedQuery, topK: 10 });
    const official = await ctx.x23.officialHybridAnswer({ query: seedQuery, topK: 5 });

    const claims = [] as FactCheckOutput['claims'];
    // Placeholder: claims would be extracted from sources and labeled supported/contested/unknown

    ctx.trace.addStep({
      type: 'factCheck',
      description: 'Collected sources via hybrid + official search',
      input: { query: seedQuery },
      output: {
        topHits: results.slice(0, 5).map((d) => ({ title: d.title, uri: d.uri })),
        officialSummary: official.answer,
      },
      references: [
        ...results.slice(0, 3).map((d) => ({ source: d.source || 'search', uri: d.uri || '' })),
        ...official.citations.slice(0, 2).map((d) => ({ source: 'official', uri: d.uri || '' })),
      ],
    });

    return { claims, keyEvidence: (results.concat(official.citations).map((d) => d.uri).filter(Boolean) as string[]) };
  },
};

