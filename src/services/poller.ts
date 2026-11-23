import { storage } from './storage';
import { ProviderFactory } from './provider-factory';
import { addInboundMessage, createContact, lookupContactByPhone, updateMessageStatus } from './ghl-api';

let outboundRunning = false;
let inboundRunning = false;
// Pulling an inbox that is not enabled returns 403 every cycle; back off per provider.
const inboundCooldown = new Map<string, number>();

function toE164(phone: string): string {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return digits ? `+${digits}` : String(phone || '');
}

/**
 * Delivery receipts are pulled from the provider (Reve: getstatus,
 * Icombd: message-logs/get-report) and pushed to HighLevel.
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
        if (!configured) {
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

/**
 * Two-way SMS: Icombd exposes an inbox pull endpoint. New messages are added to
 * the matching contact's conversation in HighLevel.
 */
export async function pollInboundOnce(): Promise<void> {
  if (inboundRunning) return;
  inboundRunning = true;
  try {
    for (const locationId of storage.getAllConfiguredLocations()) {
      const creds = storage.getCredentialsRaw(locationId);
      if (!creds) continue;

      for (const configured of creds.providers.filter((p) => p.type === 'icombd')) {
        const provider = ProviderFactory.getProvider(configured.type);
        if (!provider.pullInbound) continue;

        const cooldownKey = `${locationId}:${configured.id}`;
        if (Date.now() < (inboundCooldown.get(cooldownKey) || 0)) continue;

        let messages;
        try {
          messages = await provider.pullInbound(configured.config);
        } catch (error: any) {
          console.error('[Inbound] Pull failed:', error.message);
          // e.g. 403 "SMS Inbox feature is not enabled" — retry in 30 minutes, not every cycle.
          inboundCooldown.set(cooldownKey, Date.now() + 30 * 60 * 1000);
          continue;
        }

        for (const msg of messages) {
          const key = `icombd:${msg.id}`;
          if (!msg.id || storage.isMessageProcessed(key)) continue;

          const phone = toE164(msg.from);
          let contact;
          try {
            contact = await lookupContactByPhone(locationId, phone);
          } catch (error: any) {
            console.error('[Inbound] Contact lookup failed:', error.message);
            continue;
          }

          if (!contact) {
            // A reply from an unknown number should still appear: create the contact.
            try {
              contact = await createContact(locationId, phone);
              console.log('[Inbound] Created contact for an incoming number');
            } catch (error: any) {
              storage.markMessageProcessed(key);
              console.error('[Inbound] Could not create contact:', error.message);
              continue;
            }
          }

          try {
            await addInboundMessage(locationId, {
              contactId: contact.id,
              message: msg.message,
              date: msg.receivedAt,
            });
            storage.markMessageProcessed(key);
            console.log('[Inbound] Message added for location:', locationId);
          } catch (error: any) {
            console.error('[Inbound] Add failed:', error.message);
          }
        }
      }
    }
  } finally {
    inboundRunning = false;
  }
}

export function startPollers(): void {
  if (process.env.POLLING_ENABLED === 'false') {
    console.log('[Poll] Disabled by POLLING_ENABLED=false');
    return;
  }
  // Guard against bad env values (NaN would turn setInterval into a busy loop).
  const ms = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 5000 ? Math.floor(parsed) : fallback;
  };
  const statusInterval = ms(process.env.POLL_INTERVAL_MS, 45000);
  const inboundInterval = ms(process.env.INBOUND_POLL_INTERVAL_MS, 25000);

  setInterval(() => {
    pollOutboundOnce().catch((e) => console.error('[Status] Loop error:', e.message));
  }, statusInterval).unref();
  setInterval(() => {
    pollInboundOnce().catch((e) => console.error('[Inbound] Loop error:', e.message));
  }, inboundInterval).unref();
  // Check once immediately so a restart doesn't add a full interval of delay.
  pollInboundOnce().catch((e) => console.error('[Inbound] Initial poll error:', e.message));
  setInterval(() => {
    try {
      storage.cleanupOldRecords(30);
    } catch (e: any) {
      console.error('[Cleanup] Failed:', e.message);
    }
  }, 24 * 60 * 60 * 1000).unref();
  console.log('[Poll] Delivery every', statusInterval, 'ms; inbound every', inboundInterval, 'ms');
}
