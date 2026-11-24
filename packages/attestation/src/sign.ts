import { recoverMessageAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export async function signDigest(digest: Hex, privateKey: Hex): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signMessage({ message: { raw: digest } });
}

export async function recoverDigestSigner(digest: Hex, signature: Hex): Promise<string> {
  return (await recoverMessageAddress({ message: { raw: digest }, signature })).toLowerCase();
}
