import crypto from 'node:crypto';

// HighLevel signs Conversation Provider delivery webhooks with Ed25519.
// Public key from:
// https://marketplace.gohighlevel.com/docs/webhook/ProviderOutboundMessage
const DEFAULT_GHL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

export function ghlWebhookPublicKey(): string {
  const configured = process.env.GHL_WEBHOOK_PUBLIC_KEY;
  if (configured && configured.trim()) {
    // Environment variables usually cannot hold real newlines.
    return configured.includes('\\n') ? configured.replace(/\\n/g, '\n') : configured;
  }
  return DEFAULT_GHL_PUBLIC_KEY;
}

/**
 * Verifies the X-GHL-Signature header against the raw request body.
 * Must be called with the exact bytes received (before JSON parsing).
 */
export function verifyGhlSignature(
  rawBody: Buffer | string | undefined,
  signature: string | string[] | undefined
): boolean {
  if (!rawBody) return false;
  if (!signature || Array.isArray(signature) || signature === 'N/A') return false;

  try {
    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'base64');
    return crypto.verify(null, payload, ghlWebhookPublicKey(), signatureBuffer);
  } catch (error) {
    console.error('[Webhook] Signature verification failed:', (error as Error).message);
    return false;
  }
}
