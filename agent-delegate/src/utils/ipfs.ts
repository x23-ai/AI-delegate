import { createHelia, Helia } from 'helia';
import { json } from '@helia/json';
import { CID } from 'multiformats/cid';

let heliaNode: Helia | null = null;

/** Lazy-initialize a Helia node */
async function getHelia(): Promise<Helia> {
  if (!heliaNode) {
    heliaNode = await createHelia();
  }
  return heliaNode;
}

/**
 * Publish any JSON-serializable object to IPFS.
 * @returns CIDv1 base32 string
 */
export async function publishJsonToIpfs(payload: any): Promise<string> {
  const node = await getHelia();
  const j = json(node);
  const cid = await j.add(payload);
  return cid.toString();
}

/**
 * Fetch JSON back from IPFS.
 */
export async function fetchJsonFromIpfs<T = any>(cidStr: string): Promise<T> {
  const node = await getHelia();
  const j = json(node);
  return (await j.get(CID.parse(cidStr))) as Promise<T>;
}
