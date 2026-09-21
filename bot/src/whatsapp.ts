/**
 * Sending a reply, and reading what arrived.
 *
 * The inbound shape is Meta's, and it is nested three levels deep with every level optional.
 * Everything here treats a missing field as "no message" rather than trusting the envelope.
 */

export type InboundMessage = { waId: string; text: string; messageId: string };

type Envelope = {
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; id?: string; type?: string; text?: { body?: string } }[];
      };
    }[];
  }[];
};

/** Only text messages. An image or a voice note is not a command, and guessing is not our job. */
export function readMessages(payload: unknown): InboundMessage[] {
  const envelope = payload as Envelope;
  const found: InboundMessage[] = [];

  for (const entry of envelope?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const message of change?.value?.messages ?? []) {
        if (message?.type !== "text") continue;
        const waId = message.from;
        const text = message.text?.body;
        const messageId = message.id;
        if (!waId || !text || !messageId) continue;
        found.push({ waId, text, messageId });
      }
    }
  }
  return found;
}

export class WhatsAppClient {
  readonly #url: string;
  readonly #accessToken: string;

  constructor(config: { graphBaseUrl: string; phoneNumberId: string; accessToken: string }) {
    this.#url = `${config.graphBaseUrl}/${config.phoneNumberId}/messages`;
    this.#accessToken = config.accessToken;
  }

  async sendText(to: string, body: string): Promise<void> {
    const response = await fetch(this.#url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        // Links are previewed by WhatsApp; the preview is the sender's first sight of the app.
        text: { preview_url: true, body },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // The access token can appear in Meta's own error text, so the body is not logged verbatim.
      throw new Error(`whatsapp send failed: status ${response.status}`);
    }
  }
}
