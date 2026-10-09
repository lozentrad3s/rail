/**
 * Understanding a message written the way people actually write.
 *
 * `commands.ts` knows the exact forms. This is the layer behind it, for everything else a person
 * types to a payments chat: "can you send 20k to my mum please", "how much do I have?", "is this
 * safe?", "what if the provider doesn't pay?". It is deterministic and offline, so it is fast, free,
 * testable, and works whether or not the assistant behind it is configured.
 *
 * It only ever produces the same intents the commands do, plus questions about Rail. It cannot be
 * talked into anything else, which is what keeps this a payments bot and not a general assistant.
 */
import { parseAmount } from "./amounts.ts";
import type { Command } from "./commands.ts";

/** Questions about Rail that have a written answer in `messages/`. */
export type Topic =
  | "safety"
  | "speed"
  | "cost"
  | "providers"
  | "no-provider"
  | "provider-fails"
  | "corridors"
  | "recipient"
  | "privacy"
  | "how"
  | "who"
  | "thanks";

export type Understood =
  | Command
  | { kind: "answer"; topic: Topic }
  | { kind: "send-needs-amount"; contactName: string };

/** Words around a request that carry no meaning for it. */
const LEAD = /^(?:(?:please|pls|plz|kindly|hey|hi|hello|ok|okay|so|um|rail)[,!.]?\s+)*(?:(?:can|could|would|will) you\s+|i(?:'d| would) like to\s+|i want(?: to)?\s+|i wanna\s+|i need to\s+|help me(?: to)?\s+|let me\s+|let's\s+)?/i;
const TRAIL = /(?:\s+(?:please|pls|plz|for me|now|today|thanks|thank you|asap))+[.!?]*$|[.!?]+$/i;

/** "my mum", "to mummy", "for dad" → "mum", "mummy", "dad". */
function cleanName(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:to|for)\s+/i, "")
    .replace(/^(?:my|our)\s+/i, "")
    .trim();
}

/** An amount written anywhere a person might write one, or undefined. */
const AMOUNT = String.raw`(?:₦|ngn\s*|n)?\s*\d[\d,.\s]*(?:\s*(?:k|m|thousand|grand|million|mil))?(?:\s*(?:naira|ngn))?`;

function asSend(rest: string): Understood | undefined {
  // "20k to mum"
  const amountFirst = new RegExp(`^(${AMOUNT})\\s+(?:to|for)\\s+(.+)$`, "i").exec(rest);
  if (amountFirst) {
    const amount = parseAmount(amountFirst[1] ?? "");
    if (amount !== undefined) return { kind: "send", localAmount: amount, contactName: cleanName(amountFirst[2] ?? "") };
  }
  // "mum 20k", "my mum 20,000 naira"
  const nameFirst = new RegExp(`^(.+?)\\s+(${AMOUNT})$`, "i").exec(rest);
  if (nameFirst) {
    const amount = parseAmount(nameFirst[2] ?? "");
    if (amount !== undefined) return { kind: "send", localAmount: amount, contactName: cleanName(nameFirst[1] ?? "") };
  }
  // "money to mum", "some money to my sister": who, but not how much.
  const noAmount = /^(?:some\s+)?(?:money|cash|funds)?\s*(?:to|for)\s+(.+)$/i.exec(rest);
  if (noAmount) return { kind: "send-needs-amount", contactName: cleanName(noAmount[1] ?? "") };
  return undefined;
}

/** Ordered: the first that matches wins, so the more specific questions come first. */
const QUESTIONS: [RegExp, Understood][] = [
  [/\b(?:how much|what) (?:do|have) i (?:have|got)\b|\bmy balance\b|\bhow much (?:is )?(?:left|in my account)\b|\bcheck (?:my )?(?:balance|account)\b/i, { kind: "balance" }],
  [/\bwho (?:can|do) i (?:send|pay)\b|\bmy (?:contacts|recipients|people)\b|\bwho have i (?:added|saved)\b|\bshow (?:me )?(?:my )?(?:contacts|recipients)\b/i, { kind: "contacts" }],
  [/\b(?:what(?:'s| is) the|today'?s|exchange|current) rate\b|\bhow much is (?:a|one|1) dollar\b|\bdollars? (?:to|in) naira\b|\bnaira rate\b/i, { kind: "rate" }],
  [/\b(?:top ?up|add (?:some )?money|put (?:some )?money in|fund (?:my )?account|deposit)\b/i, { kind: "fund" }],
  [/\b(?:doesn'?t|does not|didn'?t|did not|never|fails? to|won'?t|refuses? to) (?:pay|deliver|send)\b|\bprovider (?:fails|scams|runs|disappears|cheats)\b|\bwhat if (?:the )?provider\b/i, { kind: "answer", topic: "provider-fails" }],
  [/\b(?:no ?(?:one|body|provider)) (?:bids?|takes?|picks?)\b|\bmoney back\b|\brefund\b|\b(?:stuck|pending|still running|not arrived|hasn'?t arrived|didn'?t arrive|where is my money)\b/i, { kind: "answer", topic: "no-provider" }],
  [/\b(?:safe|secure|trust|scam|legit|guarantee[ds]?|risk|protected)\b/i, { kind: "answer", topic: "safety" }],
  [/\b(?:how long|how fast|how quick|when will|how much time|instant(?:ly)?|takes? long)\b/i, { kind: "answer", topic: "speed" }],
  [/\b(?:fees?|charges?|commission|cost|how much does it cost|cheap|expensive|price)\b/i, { kind: "answer", topic: "cost" }],
  [/\b(?:ghana|kenya|south africa|india|philippines|pakistan|europe|the uk|united kingdom|the us|usa|america|brazil|which countr|what countr|where can i send|other countr|corridors?)\b/i, { kind: "answer", topic: "corridors" }],
  [/\b(?:does|do|will) (?:she|he|they|my \w+|the recipient|my family|recipients?) (?:need|have to)\b|\bneed an app\b|\brecipient needs?\b/i, { kind: "answer", topic: "recipient" }],
  [/\b(?:privacy|private|my data|bank details|account details|account number)\b/i, { kind: "answer", topic: "privacy" }],
  [/\bproviders?\b|\bwho (?:pays|delivers|sends)\b|\bauction\b|\bbid(?:s|ding)?\b/i, { kind: "answer", topic: "providers" }],
  [/\bwho are you\b|\bare you (?:a )?(?:bot|robot|human|real|person|ai)\b|\bwhat can you do\b/i, { kind: "answer", topic: "who" }],
  [/\bhow (?:does|do) (?:it|this|rail|you) work\b|\bwhat is rail\b|\bwhat(?:'s| is) this\b|\bexplain\b|\btell me (?:about|more)\b/i, { kind: "answer", topic: "how" }],
  [/^(?:thanks|thank you|thx|ty|cheers|ok(?:ay)?|cool|great|nice|perfect|awesome|got it|alright)\b/i, { kind: "answer", topic: "thanks" }],
];

/** Returns what the message means, or undefined when this layer cannot tell. */
export function understand(raw: string): Understood | undefined {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return undefined;

  const core = text.replace(LEAD, "").replace(TRAIL, "").trim();

  // Short greetings with something tacked on: "hi there", "hello rail", "good morning!".
  if (/^(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening)|howdy|yo)\b[\s\w!,.]{0,20}$/i.test(text) && !/\d/.test(text)) {
    return { kind: "welcome" };
  }

  const send = /^(?:send|transfer|pay|give|wire|remit)\s+(.+)$/i.exec(core);
  if (send) {
    const understood = asSend(send[1] ?? "");
    if (understood) return understood;
  }

  const add = /^(?:add|save|new (?:contact|recipient)(?: called)?|create (?:a )?(?:contact|recipient)(?: for)?)\s+(.+)$/i.exec(core);
  if (add) return { kind: "add", contactName: cleanName(add[1] ?? "") };

  const remove = /^(?:remove|forget|delete)\s+(.+)$/i.exec(core);
  if (remove) return { kind: "remove", contactName: cleanName(remove[1] ?? "") };

  for (const [pattern, meaning] of QUESTIONS) if (pattern.test(text)) return meaning;
  return undefined;
}
