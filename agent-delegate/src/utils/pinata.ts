import { PinataSDK } from 'pinata';

let pinata: PinataSDK | null;

function getPinata() {
  if (!pinata) {
    const PINATA_JWT = process.env.PINATA_JWT;
    const PINATA_GATEWAY = process.env.PINATA_GATEWAY;

    if (!PINATA_JWT) {
      throw new Error('PINATA_JWT environment variable is not set');
    }

    if (!PINATA_GATEWAY) {
      throw new Error('PINATA_GATEWAY environment variable is not set');
    }

    pinata = new PinataSDK({
      pinataJwt: PINATA_JWT,
      pinataGateway: PINATA_GATEWAY,
    });
  }
  return pinata;
}

export async function uploadJsonToIpfs(json: any, filename: string) {
  try {
    const result = await getPinata().upload.public.json(json).name(filename);
    return result.cid;
  } catch (error) {
    console.error('Error uploading JSON to Pinata:', error);
    throw error;
  }
}
