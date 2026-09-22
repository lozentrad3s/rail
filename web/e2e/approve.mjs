/**
 * The whole journey, from a WhatsApp draft to a settled transfer.
 *
 * A real Chrome with a virtual authenticator that supports the WebAuthn PRF extension stands in
 * for a face. Nothing else is stubbed: the passkey derives a real account, the account signs a real
 * EIP-3009 authorisation, the relayer submits it to Monad, and providers bid for it.
 *
 *   1. /start creates a passkey and derives an account that holds nothing
 *   2. the account is funded, the way a person would fund theirs
 *   3. the bot's own endpoints build the draft a chat would have built
 *   4. /c/<draftId> shows the proposal and one tap approves it
 *   5. the order is watched until it settles, and the sender gets the auction saving back
 *
 * Step 4 is the one that matters: if a passkey ever stops producing an authorisation the escrow
 * accepts, nobody can send anything.
 *
 *   npm run test:approve
 *
 * Needs a relayer, two matchers and `next dev` already running, plus TESTNET_DEPLOYER_PRIVATE_KEY
 * to fund the new account and RPC_URL to reach the chain.
 */
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://localhost:3000";
const RELAYER = process.env.RELAYER_BASE_URL || "http://127.0.0.1:8790";
const BOT_KEY = process.env.BOT_API_KEY || "e2e-key";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const AUSD = process.env.AUSD_ADDRESS || "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const WA_ID = "2349166358325";

/** Enough for the transfer, its fee and the reserve above it. */
const FUNDING_UNITS = 40_000_000n;

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ok" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};

const dollars = (units) => `$${formatUnits(BigInt(units), 6)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, init) {
  const response = await fetch(`${RELAYER}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${BOT_KEY}`, ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${body?.error?.message ?? response.status}`);
  return body;
}

const rpc = process.env.RPC_URL || monadTestnet.rpcUrls.default.http[0];
const chain = createPublicClient({ chain: monadTestnet, transport: http(rpc) });

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });

  const problems = [];
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
  page.on("pageerror", (error) => problems.push(String(error)));

  const cdp = await page.createCDPSession();
  await cdp.send("WebAuthn.enable", { enableUI: false });

  // A platform authenticator with PRF and resident keys — what an iPhone presents.
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });

  const tap = async (text) => {
    for (const handle of await page.$$("button")) {
      const label = await page.evaluate((el) => el.textContent?.trim() ?? "", handle);
      if (label.includes(text)) return handle.click();
    }
    throw new Error(`no button containing "${text}" — page said: ${await page.evaluate(() => document.body.innerText)}`);
  };

  // ── 1. an account, from a face ──────────────────────────────────────────────
  await page.goto(`${BASE}/start`, { waitUntil: "networkidle0" });
  await tap("Set up with Face ID");
  await page.waitForFunction(() => location.pathname === "/account", { timeout: 30_000 });

  const account = JSON.parse(await page.evaluate(() => localStorage.getItem("rail.account.v1")));
  check("a passkey derives an account", /^0x[0-9a-fA-F]{40}$/.test(account.address), account.address);

  const emptyBalance = await chain.readContract({
    address: AUSD,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  check("the new account starts with nothing", emptyBalance === 0n, dollars(emptyBalance));

  // ── 2. funding it ───────────────────────────────────────────────────────────
  const funder = privateKeyToAccount(process.env.TESTNET_DEPLOYER_PRIVATE_KEY);
  const wallet = createWalletClient({ account: funder, chain: monadTestnet, transport: http(rpc) });

  // Monad charges the declared limit, not the gas used, so this is measured rather than guessed.
  const fundingHash = await wallet.writeContract({
    address: AUSD,
    abi: erc20Abi,
    functionName: "transfer",
    args: [account.address, FUNDING_UNITS],
    gas: 100_000n,
  });
  await chain.waitForTransactionReceipt({ hash: fundingHash });

  const funded = await chain.readContract({
    address: AUSD,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  check("the account is funded", funded === FUNDING_UNITS, dollars(funded));

  // ── 3. the draft a chat would have built ────────────────────────────────────
  const contacts = await api(`/v1/contacts?waId=${WA_ID}`);
  if (contacts.length === 0) throw new Error("seed a recipient first: services/relayer/scripts/seed-contact.ts");

  const draft = await api("/v1/drafts", {
    method: "POST",
    body: JSON.stringify({
      waId: WA_ID,
      contactId: contacts[0].contactId,
      currency: "NGN",
      localAmount: "5000000",
    }),
  });
  check("the chat proposes a transfer", typeof draft.draftId === "string", draft.url);

  // ── 4. one tap ──────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/c/${draft.draftId}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => document.body.innerText.includes("Approve with Face ID"),
    { timeout: 20_000 },
  );

  const shown = await page.evaluate(() => document.body.innerText);
  check("the proposal shows the recipient in full", shown.includes(contacts[0].accountName), contacts[0].accountName);
  check("the proposal shows what it can cost at most", /Most you can pay/.test(shown));

  // The sender is never shown an order id, so it is read off the wire rather than the screen.
  let orderId = null;
  page.on("response", async (response) => {
    if (!response.url().endsWith("/v1/orders") || response.request().method() !== "POST") return;
    try {
      orderId = (await response.json())?.orderId ?? null;
    } catch {
      // A body that will not parse is a failure the assertions below will catch.
    }
  });

  await tap("Approve with Face ID");
  await page.waitForFunction(() => document.body.innerText.includes("On its way"), { timeout: 60_000 });
  check("a passkey authorises the transfer", true);

  // ── 5. the auction ──────────────────────────────────────────────────────────
  // Reading the response body is itself async, so it can land just after the screen changes.
  for (let i = 0; i < 20 && orderId === null; i += 1) await sleep(250);
  check("the order reached the chain", orderId !== null, orderId ?? "");

  if (orderId) {
    let last = "";
    let final;
    for (let i = 0; i < 40; i += 1) {
      await sleep(3000);
      const order = await api(`/v1/orders/${orderId}`);
      const line = `${order.status}${order.winner ? ` winner=${order.winner.slice(0, 10)}… bid=${dollars(order.winningBid)}` : ""}`;
      if (line !== last) {
        console.log(`  ..  ${line}`);
        last = line;
      }
      if (["Settled", "Refunded", "Cancelled"].includes(order.status)) {
        final = order;
        break;
      }
    }

    check("the transfer settled", final?.status === "Settled", final?.status ?? "still running");
    if (final?.change) {
      check("the sender got the auction saving back", BigInt(final.change) > 0n, dollars(final.change));
    }
  }
} catch (error) {
  check("the journey completed", false, String(error));

  // A timeout says nothing on its own. What the page actually said usually says everything.
  try {
    const page = (await browser?.pages())?.at(-1);
    if (page) {
      console.log(`\n  page url:  ${page.url()}`);
      console.log(`  page text: ${(await page.evaluate(() => document.body.innerText)).slice(0, 600)}`);
    }
  } catch {
    // The browser may already be gone; the original error is the one that matters.
  }
} finally {
  await browser?.close();
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
