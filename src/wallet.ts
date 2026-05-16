import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

export function loadKeypair(privateKey: string): Ed25519Keypair {
  if (privateKey.startsWith('suiprivkey1')) {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  throw new Error('Unsupported private key format; expected suiprivkey1...');
}

export function deriveAddress(privateKey: string): string {
  return loadKeypair(privateKey).toSuiAddress();
}
