import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, extname, join, relative } from 'path';

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

function listFilesRecursive(dirPath: string): string[] {
  const out: string[] = [];
  const root = resolve(dirPath);
  (function walk(d: string) {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else out.push(p);
    }
  })(root);
  return out;
}

function isTextExt(ext: string): boolean {
  return (
    [
      '.md',
      '.mdx',
      '.txt',
      '.json',
      '.csv',
      '.tsv',
      '.yaml',
      '.yml',
      '.toml',
      '.ini',
    ].includes(ext.toLowerCase())
  );
}

function clampText(s: string, max = 200_000): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function loadFromDirectory(dirPath: string): Partial<ProposalParams> | undefined {
  const p = resolve(dirPath);
  if (!existsSync(p)) return undefined;
  const st = statSync(p);
  if (!st.isDirectory()) return undefined;

  let id: number | undefined;
  let title: string | undefined;
  let description: string | undefined;
  const payload: ProposalPayloadItem[] = [];

  const files = listFilesRecursive(p);
  // Preferential ordering for deriving title/description
  const preferNames = ['proposal.json', 'proposal.md', 'README.md', 'readme.md', 'description.md'];
  const sorted = files.sort((a, b) => {
    const an = preferNames.indexOf(relative(p, a));
    const bn = preferNames.indexOf(relative(p, b));
    const aw = an === -1 ? 999 : an;
    const bw = bn === -1 ? 999 : bn;
    if (aw !== bw) return aw - bw;
    return a.localeCompare(b);
  });

  for (const fp of sorted) {
    const rel = relative(p, fp);
    const ext = extname(fp).toLowerCase();
    if (!isTextExt(ext)) continue; // skip non-text
    const s = statSync(fp);
    if (s.size > 5_000_000) continue; // skip very large files
    const text = readFileSync(fp, 'utf-8');

    // Merge JSON metadata when present
    if (ext === '.json') {
      try {
        const data = JSON.parse(text);
        if (id === undefined && Number.isFinite(Number(data?.id))) id = Number(data.id);
        if (!title && typeof data?.title === 'string' && data.title.trim()) title = data.title.trim();
        if (!description && typeof data?.description === 'string' && data.description.trim())
          description = data.description.trim();
        if (Array.isArray(data?.payload)) {
          for (const item of data.payload) {
            try {
              const it = item as ProposalPayloadItem;
              if (it && typeof it === 'object' && typeof it.type === 'string') payload.push(it);
            } catch {}
          }
        }
      } catch {
        // not valid JSON; fall through to include as raw text
      }
    }

    // Include raw file content as a payload item for the LLM to ingest
    const item: ProposalPayloadItem = {
      type: 'file',
      uri: `file://${rel}`,
      data: clampText(text),
      metadata: { path: rel, ext },
    };
    payload.push(item);

    // Derive description from markdown if still missing
    if (!description && (ext === '.md' || ext === '.mdx' || rel.toLowerCase() === 'readme.md')) {
      const md = text.trim();
      if (md) description = clampText(md, 50_000);
      // Try to derive a title from first markdown heading
      if (!title) {
        const m = md.match(/^\s*#\s+(.+)$/m);
        if (m && m[1]) title = m[1].trim();
      }
    }
  }

  return { id: id as any, title, description, payload };
}

export function loadProposalParams(): ProposalParams {
  const args = parseArgs(process.argv.slice(2));

  // 1) Inputs: directory or file
  const inputDirArg = args['input-dir'] || args['dir'];
  const inputPathArg = args.input || args['input-file'];
  let dirData: Partial<ProposalParams> | undefined;
  let fileData: any | undefined;

  // Resolve input by precedence: explicit dir -> explicit path (dir or file) -> default evaluate/ -> default file
  if (inputDirArg && existsSync(resolve(inputDirArg))) {
    dirData = loadFromDirectory(inputDirArg);
  } else if (inputPathArg && existsSync(resolve(inputPathArg))) {
    const p = resolve(inputPathArg);
    if (statSync(p).isDirectory()) dirData = loadFromDirectory(p);
    else fileData = loadJsonFile(p);
  } else if (existsSync(resolve('evaluate')) && statSync(resolve('evaluate')).isDirectory()) {
    dirData = loadFromDirectory('evaluate');
  } else if (existsSync(resolve('import/proposal.json'))) {
    fileData = loadJsonFile('import/proposal.json');
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
  const id = Number(cliId ?? dirData?.id ?? fileData?.id ?? process.env.PROPOSAL_ID ?? '0');
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Proposal id is required: pass --proposal-id or provide it in the input file');
  }

  const title = cliTitle ?? dirData?.title ?? fileData?.title;
  const description = cliDesc ?? dirData?.description ?? fileData?.description;
  const payload: ProposalPayloadItem[] | undefined =
    payloadFromFile ?? (Array.isArray(dirData?.payload) || Array.isArray(fileData?.payload)
      ? [...(dirData?.payload || []), ...(fileData?.payload || [])]
      : dirData?.payload || fileData?.payload);

  return { id, title, description, payload };
}

export function getCliArgs(): Record<string, string> {
  return parseArgs(process.argv.slice(2));
}
