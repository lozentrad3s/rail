/**
 * Saves a recipient without Paystack, for development only.
 *
 * Normally `POST /v1/contacts` resolves the account name through Paystack before saving, because
 * seeing "ADAEZE O. OKONKWO" before Face ID is the check that stops money going to the wrong
 * person. Without a Paystack key that path cannot run, and nothing downstream of it can be tested.
 *
 * So this writes the same record the app would, through the same module, with a name supplied on
 * the command line. It is a script beside the service, never a route inside it: there is no way to
 * reach this over the network, and the real path keeps its check.
 *
 *   node scripts/seed-contact.ts <waId> <name> <bankCode> <bankName> <accountNumber> <accountName>
 *
 * Needs VAULT_DIR and RECIPIENT_ENCRYPTION_KEY to match the running relayer, plus RELAYER_BASE_URL
 * and BOT_API_KEY to mint the link this consumes.
 */
import type { Hex } from "viem";

import { createContactLink, saveContact } from "../src/contacts.ts";
import { Vault } from "../src/vault.ts";

const [waId, contactName, bankCode, bankName, accountNumber, accountName] = process.argv.slice(2);

if (!waId || !contactName || !bankCode || !bankName || !accountNumber || !accountName) {
  console.error(
    "usage: node scripts/seed-contact.ts <waId> <name> <bankCode> <bankName> <accountNumber> <accountName>",
  );
  process.exit(2);
}

const key = process.env.RECIPIENT_ENCRYPTION_KEY?.trim();
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("RECIPIENT_ENCRYPTION_KEY must be 32 bytes of hex, and must match the running relayer.");
  process.exit(2);
}

const vault = new Vault(process.env.VAULT_DIR ?? ".vault", key as Hex);

// The link is created through the vault directly so this works whether or not a relayer is running.
const { url } = createContactLink(vault, { waId, contactName }, "http://seed.local");
const token = url.split("/k/")[1] as string;

const summary = saveContact(vault, {
  token,
  currency: process.env.CURRENCY ?? "NGN",
  bankCode,
  bankName,
  accountNumber,
  accountName,
});

// The full account number is deliberately absent here, as it is everywhere outside the app.
console.log(JSON.stringify(summary, null, 2));
