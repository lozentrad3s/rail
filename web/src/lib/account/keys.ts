// Key derivation from a passkey's PRF output — docs/INTERFACES.md §5.5.1.

import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** Index 0 spends; index 1 is the savings account ("one passkey, many keys"). */
export const SPENDING_INDEX = 0;
export const SAVINGS_INDEX = 1;

/**
 * Derives the secp256k1 private key for one account of a passkey.
 *
 * The same PRF output always produces the same keys, which is what makes a passkey a recoverable
 * account rather than a phrase someone has to write down. The returned bytes are secret: hand them
 * straight to a signing session and never persist or log them.
 */
export function deriveKey(prfOutput: Uint8Array, index = SPENDING_INDEX): Uint8Array {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${index}`);
  if (node.privateKey === null) throw new Error("derivation produced no key");
  return node.privateKey;
}
