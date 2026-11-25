import { storage } from './storage';
import { ProviderFactory } from './provider-factory';
import { updateMessageStatus } from './ghl-api';

let outboundRunning = false;

/**
 * Delivery receipt polling fallback for Zender outbound messages.
 * Zender webhooks also push status updates immediately when configured.
 */
export async function pollOutboundOnce(): Promise<void> {
  if (outboundRunning) return;
  outboundRunning = true;
  try {
    const pending = storage.listPendingOutboundMessages(25);
    for (const record of pending) {
      try {
        const creds = storage.getCredentialsRaw(record.location_id);
        const configured = creds?.providers?.find((p) => p.id === record.provider_id);
        if (!configured || configured.type !== 'zender') {
          storage.deleteOutboundMessage(record.ghl_message_id);
          continue;
        }
        const provider = ProviderFactory.getProvider(configured.type);
        if (!provider.getStatus) {
          storage.deleteOutboundMessage(record.ghl_message_id);
          continue;
        }

        const status = await provider.getStatus(record.provider_message_id, configured.config);
        if (status === 'delivered' || status === 'failed') {
          await updateMessageStatus(
            record.location_id,
            record.ghl_message_id,
            status,
            status === 'failed'
              ? { code: 'provider_error', type: 'provider', message: 'The carrier reported the message as undelivered.' }
              : undefined
          );
          storage.deleteOutboundMessage(record.ghl_message_id);
          console.log('[Status] Message marked', status);
        } else {
          storage.updateOutboundMessage(record.ghl_message_id, status);
        }
      } catch (error: any) {
        console.error('[Status] Poll failed:', error.message);
        storage.updateOutboundMessage(record.ghl_message_id, 'pending');
      }
    }
  } finally {
    outboundRunning = false;
  }
}

export function startPollers(): void {
  if (process.env.POLLING_ENABLED === 'false') {
    console.log('[Poll] Disabled by POLLING_ENABLED=false');
    return;
  }
  const ms = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 5000 ? Math.floor(parsed) : fallback;
  };
  const statusInterval = ms(process.env.POLL_INTERVAL_MS, 45000);

  setInterval(() => {
    pollOutboundOnce().catch((e) => console.error('[Status] Loop error:', e.message));
  }, statusInterval).unref();
  setInterval(() => {
    try {
      storage.cleanupOldRecords(30);
    } catch (e: any) {
      console.error('[Cleanup] Failed:', e.message);
    }
  }, 24 * 60 * 60 * 1000).unref();
  console.log('[Poll] Delivery every', statusInterval, 'ms');
}
