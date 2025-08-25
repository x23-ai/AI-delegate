// Curated sources catalog used by the Source QA tool.
// Each entry represents a specific URL with a clearly defined scope.

export type CuratedSource = {
  id: string; // stable identifier (lowercase, kebab/underscore)
  url: string; // canonical URL for crawling
  scope: string; // one-line purpose/what it answers
  answers?: string[]; // example intents/questions it can answer
  limits?: string[]; // what it does NOT answer
  freshness?: string; // update cadence or last_updated
  examples?: { good?: string[]; bad?: string[] };
  notes?: string; // caveats or special instructions
};

export const CURATED_SOURCES: CuratedSource[] = [
  {
    id: 'anticapture-commission-charter-v2-0',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Anticapture%20Commission%20Charter%20v2.0.md',
    scope: "Defines the Anti-capture Commission's mission, structure, and governance role",
    answers: [
      'role of the Anti-capture Commission',
      'membership criteria and responsibilities',
      'scope of authority for interventions',
    ],
    limits: ['other council charters', 'technical operational processes', 'roadmap details'],
    freshness: 'Version-controlled on GitHub; latest is v2.0 as of current date',
    examples: {
      good: [
        'What does the Anti-capture Commission do?',
        'How is the Anti-capture Commission composed?',
      ],
      bad: ['What are the token unlock schedules?', 'Where is the grants dashboard?'],
    },
    notes: 'Hosted in GitHub operating-manual; updates via repository commits.',
  },
  {
    id: 'maintenance-upgrade-proposal-template',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Maintenance%20Upgrade%20Proposal%20Template.md',
    scope: 'Template outlining structure for proposing maintenance upgrades to the protocol',
    answers: [
      'what fields are required in a maintenance proposal',
      'format for describing upgrades',
    ],
    limits: [
      'policy on frequency of upgrades',
      'status of submitted proposals',
      'token economic details',
    ],
    freshness: 'Template version in GitHub; date based on last commit',
    examples: {
      good: [
        'What info do I need for a maintenance upgrade proposal?',
        'How do I format a maintenance upgrade request?',
      ],
      bad: ['Has proposal X passed?', 'What’s the OP token current supply?'],
    },
    notes: 'Use as blueprint when drafting protocol stage-specific maintenance improvements.',
  },
  {
    id: 'milestones-and-metrics-council-charter-v0-1',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Milestones%20and%20Metrics%20Council%20Charter%20v0.1.md',
    scope:
      'Charter describing the purpose, formation, and functions of the Milestones & Metrics Council',
    answers: [
      'objectives of the Milestones and Metrics Council',
      'governance process or membership selection',
    ],
    limits: [
      'specific metrics currently measured',
      'strategic focus dashboard data',
      'granting policies',
    ],
    freshness: 'Version-controlled; currently v0.1',
    examples: {
      good: ["What's the role of the Milestones & Metrics Council?", 'Who governs the metrics?'],
      bad: ['What are the current metrics numbers?', 'How to apply for a grant?'],
    },
    notes: 'One of several council charters in operating-manual.',
  },
  {
    id: 'protocol-upgrade-template',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Protocol%20Upgrade%20Template.md',
    scope: 'Template structure for standard protocol upgrade proposals',
    answers: [
      'required sections for protocol upgrade proposal',
      'information expected in a protocol upgrade draft',
    ],
    limits: [
      'status of any specific upgrades',
      'implementation details of upgrades',
      'grant procedural information',
    ],
    freshness: 'Maintained as template in GitHub; last version date via repo',
    examples: {
      good: ['How do I propose a protocol upgrade?', 'What details are needed for version bump?'],
      bad: ['Has any protocol upgrade been completed?', 'What is the upgrade timeline?'],
    },
    notes: 'Useful for formal submissions of infrastructure changes.',
  },
  {
    id: 'govnerds-contribution-path-charter-v0-1',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/govNERDs%20Contribution%20Path%20Charter%20v0.1.md',
    scope: 'Defines the govNERDs initiative and its structured contribution progression',
    answers: ['what is govNERDs contribution path', 'levels or milestones contributors go through'],
    limits: [
      'grant amounts or allocations',
      'technical development standards',
      'proposal procedures outside govNERDs',
    ],
    freshness: 'Version 0.1 in GitHub; repository-managed',
    examples: {
      good: ['What is govNERDs?', 'How do I progress as a contributor in govNERDs?'],
      bad: ['How much funding can I get?', 'Where is the Superchain dashboard?'],
    },
    notes: 'Helps new contributors understand governance pathways.',
  },
  {
    id: 'manual-overview',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/manual.md',
    scope: 'Main operating manual overview linking governance structures and procedures',
    answers: [
      'overall structure of the operating-manual',
      'where to find specific council charters or processes',
    ],
    limits: ['granular policy details', 'up-to-date dashboard metrics', 'financial spreadsheets'],
    freshness: 'Updated via main branch; check latest commit',
    examples: {
      good: [
        'Where can I find the Security Council Charter?',
        "What's the relationship between different councils?",
      ],
      bad: ['What is the current OP supply?', 'Show me strategic priorities metrics.'],
    },
    notes: 'Entrypoint for navigating operating-manual documentation.',
  },
  {
    id: 'law-of-chains',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Law%20of%20Chains.md',
    scope: 'Philosophical or policy principles that underpin chain-of-chains consensus in Optimism',
    answers: [
      'what are the Law of Chains principles',
      'guiding philosophy of chain-of-chains layering',
    ],
    limits: [
      'technical implementation details',
      'metrics or performance dashboards',
      'grant procedures',
    ],
    freshness: 'Conceptual guideline in GitHub, updated as needed',
    examples: {
      good: [
        'What does Law of Chains mean?',
        'What philosophical guidelines support multi-chain structure?',
      ],
      bad: ['How many chains are connected in Superchain?', 'What is the circulating supply?'],
    },
    notes: 'Useful for understanding meta-governance rationale.',
  },
  {
    id: 'developer-advisory-board-charter-v1-1',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Developer%20Advisory%20Board%20Charter%20v1.1.md',
    scope: "Charter outlining the Developer Advisory Board's role in technical governance",
    answers: [
      'mandate of the Developer Advisory Board',
      'membership criteria and responsibilities',
    ],
    limits: [
      'budget or treasury questions',
      'grant application process',
      'superchain strategic metrics',
    ],
    freshness: 'Version 1.1 tracked in GitHub',
    examples: {
      good: ['Who sits on the Developer Advisory Board?', 'What is the board tasked with?'],
      bad: ['What is the OP unlock schedule?', 'Show me the health dashboard.'],
    },
    notes: 'Critical for navigating developer-level governance.',
  },
  {
    id: 'grants-council-charter-v0-1',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Grants%20Council%20Charter%20v0.1.md',
    scope:
      'Defines the Grants Council’s charter—purpose, structure, and governance in awarding grants',
    answers: ['what is the Grants Council responsible for', 'how are grant decisions structured'],
    limits: ['specific award amounts', 'current grant applications', 'token supply data'],
    freshness: 'Version 0.1 in GitHub',
    examples: {
      good: ['What does the Grants Council control?', 'How is grant authority structured?'],
      bad: ['What grant is funded for project X?', 'How much is budgeted this quarter?'],
    },
    notes: 'Key for understanding how grants governance operates.',
  },
  {
    id: 'security-council-charter-v0-1',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Security%20Council%20Charter%20v0.1.md',
    scope: 'Charter describing the Security Council’s mandate, structure, and responsibilities',
    answers: ['role and authority of the Security Council', 'when Security Council may intervene'],
    limits: [
      'specific incidents or security events',
      'real-time health monitoring',
      'treasury details',
    ],
    freshness: 'Version 0.1 in GitHub',
    examples: {
      good: ['What is the Security Council?', 'What is their responsibility scope?'],
      bad: ['Did they respond to incident X?', 'What’s OP token supply?'],
    },
    notes: 'Critical for understanding defensive governance mechanisms.',
  },
  {
    id: 'standard-rollup-charter',
    url: 'https://github.com/ethereum-optimism/OPerating-manual/blob/main/Standard%20Rollup%20Charter.md',
    scope: "Charter laying out philosophy and requirements for 'standard' rollup chains",
    answers: [
      'what defines a standard rollup under Optimism',
      'requirements or governance expectations for rollups',
    ],
    limits: ['rollup-specific performance metrics', 'dashboards', 'budget details'],
    freshness: 'Repo-hosted; version per latest commit',
    examples: {
      good: ['What is a standard rollup?', 'What governance applies to rollup operators?'],
      bad: ['Show rollup traffic metrics.', 'What is the OP unlock schedule?'],
    },
    notes: 'Guides rollup protocol alignment with Optimism norms.',
  },
  {
    id: 'superchain-health-dashboard',
    url: 'https://docs.google.com/spreadsheets/d/1f-uIW_PzlGQ_XFAmsf9FYiUf0N9l_nePwDVrw0D5MXY/edit?gid=192497306',
    scope: 'Live health dashboard for Superchain, tracking operational metrics',
    answers: ['current health metrics for Superchain', 'status of different chains or services'],
    limits: ['governance charters', 'policy documents', 'grant tracking'],
    freshness: 'Live spreadsheet—likely real-time or continuously updated',
    examples: {
      good: [
        'what is the current marketshare of the superchain',
        'what is the collective revenue',
        'what is the current TVL across Superchain',
        'what is the network revenue this month?',
      ],
      bad: ['What is the Grants Council structure?', 'What’s the OP circulating supply?'],
    },
    notes: 'Requires spreadsheet access; check sharing permissions if needed.',
  },
  {
    id: 'superchain-2025-strategic-focus-dashboard',
    url: 'https://app.hex.tech/61bffa12-d60b-484c-80b9-14265e268538/app/SHARED-Superchain-2025-Strategic-Focus-Dashboard-6PG9Tq3k1A32g5K8vk8vBu/latest',
    scope: 'Dashboard outlining 2025 strategic score cards and metrics for Superchain',
    answers: [
      'what are Superchain’s key metric scorecards',
      'app fees per day',
      'superchain key metrics',
    ],
    limits: ['governance charters', 'detailed metrics outside strategy scope', 'financial data'],
    freshness: 'Live via HEX dashboard—updates as underlying data changes',
    examples: {
      good: [
        'what is the current TVL across Superchain',
        'what are the app fees paid',
        'what are transaction fees per day',
        'what is the superchain revenue per day',
        'what is median gas fee per transaction',
      ],
      bad: ["Explain the Security Council's powers.", 'What is the OP circulating supply?'],
    },
    notes: 'Hosted on HEX; may require access or login.',
  },
  {
    id: 'relevant-contract-addresses',
    url: 'https://community.optimism.io/welcome/faq/dashboard-trackers#relevant-addresses',
    scope: 'Compilation of relevant contract addresses used in dashboards or governance tracking',
    answers: [
      'where to find addresses for OP token, DAO vaults, etc.',
      'which contracts are tracked in dashboards',
    ],
    limits: ['governance rules', 'grant details', 'supply charts'],
    freshness: 'Web-page FAQ; updates depending on documentation maintenance',
    examples: {
      good: [
        'What is the address of the OP token contract?',
        'Where do I find the governance vault address?',
      ],
      bad: ['How many grants have been disbursed?', 'What’s the Superchain health?'],
    },
    notes: 'Useful for developers building integrations or explorers.',
  },
  {
    id: 'govfund-grants-tracking',
    url: 'https://docs.google.com/spreadsheets/d/1Ul8iMTsOFUKUmqz6MK0zpgt8Ki8tFtoWKGlwXj-Op34/edit?gid=1179446718',
    scope: 'Spreadsheet tracking GovFund grants and their statuses, e.g. grant seasons',
    answers: ['which grants were approved or rejected', 'beneficiary or funding amounts per grant'],
    limits: ['charter governance processes', 'tokenomics', 'technical metrics'],
    freshness: 'Live spreadsheet; presumably updated regularly',
    examples: {
      good: ['has project X received grant funding', 'how much was the grant amount for project Y'],
      bad: ['What is the Security Council’s role?', 'OP token inflation rate?'],
    },
    notes: 'Shared via Google Sheets; access may be required.',
  },
  {
    id: 'op-token-unlocks-circulating-supply',
    url: 'https://docs.google.com/spreadsheets/d/1qVMhLmmch3s6XSbiBe8hgD4ntMkPIOhc1WrhsYsQc7M/edit?gid=470961921',
    scope: 'Spreadsheet detailing OP token unlock schedule and current circulating supply',
    answers: [
      'what is the current circulating supply of OP',
      'upcoming token unlock dates and amounts',
    ],
    limits: ['governance procedures', 'grant mechanisms', 'operational dashboards'],
    freshness: 'Live spreadsheet, presumably updated as new unlocks occur',
    examples: {
      good: [
        'When is the next OP unlock?',
        'What’s the current circulating supply?',
        'how much is available in the governance fund',
      ],
      bad: ['What’s the Grants Council procedure?', 'How is Superchain health?'],
    },
    notes: 'Key source for tokenomics tracking; might require view access.',
  },
  {
    id: 'guide-to-season-8',
    url: 'https://gov.optimism.io/t/guide-to-season-8/10001',
    scope: 'Written guide explaining what Season 8 means for Optimism governance',
    answers: [
      'what is Optimism Season 8',
      'how to participate in Season 8',
      'structures or deliverables of Season 8',
    ],
    limits: ['Season 9 details', 'dashboard metrics', 'token supply or unlock data'],
    freshness: 'Posted on governance forum; effective as of time of publishing',
    examples: {
      good: ['What happens in Season 8?', 'How do I engage in Season 8 governance?'],
      bad: ['What are the token unlock dates?', 'What’s Superchain health?'],
    },
    notes: 'Agency for contributors to orient within seasonal governance cycles.',
  },
  {
    id: 'budget-board-advisory-proposal-season-8-9',
    url: 'https://gov.optimism.io/t/final-budget-board-advisory-proposal-for-the-dao-operating-budget-for-seasons-8-and-9/10013',
    scope: 'Proposal detailing approved or suggested DAO operating budgets for Seasons 8 and 9',
    answers: [
      'what budget is allocated for Season 8',
      'how much is proposed for Season 9',
      'budget breakdown by category (if included)',
    ],
    limits: ['token supply metrics', 'grant process details', 'health dashboards'],
    freshness: 'Governance forum post; relevant to Seasons 8 & 9 budgeting',
    examples: {
      good: ['How much is budgeted for Season 8?', 'What is planned for Season 9’s budget?'],
      bad: ['What is the current circulating supply?', 'What dashboards track Superchain health?'],
    },
    notes: 'Strategic fiscal guidance for operating cycles.',
  },
  {
    id: 'superchain-ecosystem-index',
    url: 'https://www.superchain.eco/chains',
    scope: 'Index and information hub listing all Superchain-connected chains and ecosystem data',
    answers: ['which chains are part of Superchain', 'details about specific chains in Superchain'],
    limits: ['governance charters', 'budget or tokenomics details', 'operational dashboards'],
    freshness: 'Website likely updated as chains are added or changed',
    examples: {
      good: [
        'What chains make up Superchain?',
        'Tell me about chain X in Superchain.',
        'what is the DeFi TVL for Base',
        'which chains are at stage 1 decentralization',
      ],
      bad: ['How much is the OP token unlocked?', 'What is the Governance Council role?'],
    },
    notes: 'Useful directory for exploring the Superchain ecosystem.',
  },
];

export const CURATED_SOURCE_IDS = CURATED_SOURCES.map((s) => s.id);

export function getCuratedSourceById(id: string): CuratedSource | undefined {
  return CURATED_SOURCES.find((s) => s.id === id);
}
