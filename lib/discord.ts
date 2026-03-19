import nacl from "tweetnacl";
import { getRequiredEnv } from "@/lib/env";

export const DISCORD_INTERACTION_RESPONSE_TYPE = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4
} as const;

export const DISCORD_MESSAGE_FLAGS = {
  EPHEMERAL: 1 << 6
} as const;

export function verifyDiscordRequest(signature: string | null, timestamp: string | null, body: string): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  const publicKey = getRequiredEnv("DISCORD_PUBLIC_KEY");
  const message = Buffer.from(timestamp + body);
  const signatureBuffer = Buffer.from(signature, "hex");
  const publicKeyBuffer = Buffer.from(publicKey, "hex");

  return nacl.sign.detached.verify(message, signatureBuffer, publicKeyBuffer);
}

export async function sendDiscordWebhook(content: string): Promise<void> {
  const webhookUrl = getRequiredEnv("DISCORD_WEBHOOK_URL");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${text}`);
  }
}
