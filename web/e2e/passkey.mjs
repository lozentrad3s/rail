/**
 * End-to-end check of the sender sign-up flow (docs/INTERFACES.md §5.5.1).
 *
 * Runs a real Chrome with a virtual authenticator that supports the WebAuthn PRF extension — the
 * thing Mera derives the account key from — so the whole path is exercised without a human face:
 *
 *   1. /start creates a passkey and derives an account
 *   2. the balance is read from the chain for an account holding no MON
 *   3. forgetting the device and unlocking with the same passkey returns the identical address
 *
 * Step 3 is the one that matters: if derivation ever stops being deterministic, people lose access
 * to their money. It must stay green.
 *
 *   npm run test:passkey                    # against http://localhost:3000
 *   BASE=http://localhost:3101 npm run test:passkey
 *
 * Set CHROME_PATH if Chrome is not in the default location.
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ok" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.emulate({
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });

  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const cdp = await page.createCDPSession();
  await cdp.send("WebAuthn.enable", { enableUI: false });
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
    throw new Error(`no button containing "${text}"`);
  };
  const readStored = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("rail.account.v1") ?? "null"));

  await page.goto(`${BASE}/start`, { waitUntil: "networkidle0" });
  await tap("Set up with Face ID");
  await page.waitForFunction(() => location.pathname === "/account", { timeout: 30_000 });

  const created = await readStored();
  check("Face ID creates an account", /^0x[0-9a-fA-F]{40}$/.test(created?.address ?? ""), created?.address);
  check("no private key is stored on the device", !JSON.stringify(created).match(/privateKey|prf/i));

  await page.waitForFunction(
    () => {
      const shown = document.querySelector(".figure")?.textContent?.trim();
      return Boolean(shown) && shown !== "—";
    },
    { timeout: 30_000 },
  );
  const balance = await page.$eval(".figure", (el) => el.textContent.trim());
  check("balance reads without any MON", /^\$[\d,]+\.\d\d$/.test(balance), balance);

  await tap("Remove this account from this phone");
  await tap("Tap again");
  await page.waitForFunction(() => location.pathname === "/start", { timeout: 30_000 });
  await tap("I already have an account");
  await page.waitForFunction(() => location.pathname === "/account", { timeout: 30_000 });

  const restored = await readStored();
  check(
    "the same passkey derives the same account",
    restored?.address === created?.address,
    restored?.address,
  );
  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
