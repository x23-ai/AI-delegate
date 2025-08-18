import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface ProposalPayloadItem {
  type: string; // e.g., discussion, pullRequest, code, onchain, snapshot, officialDoc
  uri?: string; // optional link to the source
  data?: any; // arbitrary payload describing the item (IDs, text, hashes, etc.)
  metadata?: Record<string, any>; // optional additional metadata
}

export interface ProposalParams {
  id: number;
  title?: string;
  description?: string;
  payload?: ProposalPayloadItem[];
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? a.split('=') : [a, argv[i + 1]];
      const key = k.replace(/^--/, '');
      if (v && !v.startsWith('--')) {
        out[key] = v;
        if (!a.includes('=')) i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

function loadJsonFile(filePath: string): any | undefined {
  const p = resolve(filePath);
  if (!existsSync(p)) return undefined;
  const txt = readFileSync(p, 'utf-8');
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${p}: ${(e as Error).message}`);
  }
}

export function loadProposalParams(): ProposalParams {
  const args = parseArgs(process.argv.slice(2));

  // 1) CLI --input path or default import/proposal.json
  const inputPath = args.input || args['input-file'] || 'import/proposal.json';
  let fileData: any | undefined = undefined;
  if (existsSync(resolve(inputPath))) {
    fileData = loadJsonFile(inputPath);
  }

  // 2) CLI direct args
  const cliId = args['proposal-id'] || args['id'];
  const cliTitle = args['title'];
  const cliDesc = args['desc'] || args['description'];
  const payloadFile = args['payload-file'];
  const payloadFromFile: ProposalPayloadItem[] | undefined = payloadFile && existsSync(resolve(payloadFile))
    ? loadJsonFile(payloadFile)
    : undefined;

  // Resolve id
  const id = Number(cliId ?? fileData?.id ?? '0');
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Proposal id is required: pass --proposal-id or provide it in the input file');
  }

  const title = cliTitle ?? fileData?.title;
  const description = cliDesc ?? fileData?.description;
  const payload: ProposalPayloadItem[] | undefined = payloadFromFile ?? fileData?.payload;

  return { id, title, description, payload };
}

export function getCliArgs(): Record<string, string> {
  return parseArgs(process.argv.slice(2));
}
