/**
 * Binding a WhatsApp number to an account.
 *
 * The link proves the passkey, not the phone. A number can only be attached to an account by a
 * signature from that account, so taking over someone's WhatsApp gets an attacker nothing: they
 * cannot point the number at their own account, and they cannot move money from the real one
 * because the chat has never been able to sign anything.
 */
import { recoverMessageAddress, type Address, type Hex } from "viem";

import { RelayerError } from "./errors.ts";
import { hashId, randomToken, type Vault } from "./vault.ts";

export const ACCOUNT_LINK_TTL_SECONDS = 15 * 60;

export type AccountLink = { waId: string; createdAt: number };
export type LinkedAccount = { waId: string; address: Address; linkedAt: number };

const tokenKey = (token: string): string => `alink_${token}`;
const accountKey = (waId: string): string => `account_${hashId(waId)}`;

/** The message the app signs. Naming both the token and the address stops either being swapped. */
export function linkMessage(token: string, address: string): string {
  return `Rail link\ntoken: ${token}\naddress: ${address}`;
}

export function createAccountLink(
  vault: Vault,
  waId: string,
  appBaseUrl: string,
): { url: string; expiresAt: number } {
  if (!waId.trim()) throw new RelayerError("BAD_REQUEST", "waId is required.");

  const token = randomToken();
  const expiresAt = Math.floor(Date.now() / 1000) + ACCOUNT_LINK_TTL_SECONDS;
  vault.put(tokenKey(token), { waId, createdAt: Math.floor(Date.now() / 1000) }, { expiresAt });

  return { url: `${appBaseUrl}/l/${token}`, expiresAt };
}

/** Consumes the link and records the binding, once the account has proved it holds the key. */
export async function linkAccount(
  vault: Vault,
  input: { token: string; address: Address; signature: Hex },
): Promise<LinkedAccount> {
  const link = vault.get<AccountLink>(tokenKey(input.token));
  if (!link) throw new RelayerError("NOT_FOUND", "This link has expired. Ask for a new one.");

  const recovered = await recoverMessageAddress({
    message: linkMessage(input.token, input.address),
    signature: input.signature,
  }).catch(() => undefined);

  if (!recovered || recovered.toLowerCase() !== input.address.toLowerCase()) {
    throw new RelayerError("UNAUTHORIZED", "That signature does not match the account.");
  }

  vault.delete(tokenKey(input.token));
  const linked: LinkedAccount = {
    waId: link.waId,
    address: input.address,
    linkedAt: Math.floor(Date.now() / 1000),
  };
  vault.put(accountKey(link.waId), linked);
  return linked;
}

export function getLinkedAccount(vault: Vault, waId: string): LinkedAccount | undefined {
  return vault.get<LinkedAccount>(accountKey(waId));
}
