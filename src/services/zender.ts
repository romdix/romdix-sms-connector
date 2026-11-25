import crypto from 'node:crypto';
import axios from 'axios';
import { ProviderDeliveryStatus, SMSProvider } from './sms-provider.interface';

const ROMDIX_SMS_BASE_URL = 'https://sms.romdix.com';

export function mapZenderStatus(rawStatus: unknown): ProviderDeliveryStatus {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (status === 'delivered' || status === 'read') return 'delivered';
  if (status === 'failed' || status === 'canceled' || status === 'cancelled') return 'failed';
  if (status === 'sent') return 'sent';
  return 'pending';
}

export function verifyZenderWebhookSignature(
  rawBody: Buffer | string | undefined,
  signatureHeader: string | string[] | undefined,
  secret: string
): boolean {
  if (!rawBody || !signatureHeader || !secret) return false;
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const parts: Record<string, string> = {};
  for (const segment of String(header).split(',')) {
    const [k, v] = segment.split('=', 2);
    if (k && v) parts[k.trim()] = v.trim();
  }
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;

  const bodyText = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${bodyText}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function formatZenderError(error: any, fallback: string): string {
  const data = error?.response?.data;
  if (data && typeof data === 'object') {
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
    if (data.errors && typeof data.errors === 'object') {
      const first = Object.values(data.errors).flat()[0];
      if (typeof first === 'string' && first.trim()) return first;
    }
  }
  return error?.message || fallback;
}

export class ZenderProvider implements SMSProvider {
  async sendSMS(to: string, message: string, config: any) {
    if (!config?.zenderApiKey) {
      throw new Error('Romdix SMS API Key is required. Please update settings.');
    }
    const baseUrl = ROMDIX_SMS_BASE_URL;
    const payload: Record<string, any> = {
      to: String(to || '').trim(),
      body: String(message || ''),
    };

    const senderId = String(config.zenderSenderId || '').trim();
    if (senderId) {
      if (!/^\d+$/.test(senderId)) {
        throw new Error('Sender ID must be the numeric Sender ID from Romdix SMS (or leave blank for auto).');
      }
      payload.sender_id = Number(senderId);
    }

    const simId = String(config.zenderSimId || '').trim();
    if (simId) {
      if (!/^\d+$/.test(simId)) {
        throw new Error('SIM ID must be a numeric SIM ID from Romdix SMS (or leave blank for auto).');
      }
      payload.from_sim_id = Number(simId);
    }

    try {
      const response = await axios.post(`${baseUrl}/api/v1/messages/sms`, payload, {
        headers: {
          Authorization: `Bearer ${config.zenderApiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 15000,
      });
      return response.data;
    } catch (error: any) {
      const msg = formatZenderError(error, 'Failed to send SMS via Romdix SMS');
      console.error('Romdix SMS API Error:', msg);
      throw new Error(msg);
    }
  }

  async testConnection(config: any): Promise<boolean> {
    if (!config?.zenderApiKey) {
      throw new Error('Romdix SMS API Key is required.');
    }
    const baseUrl = ROMDIX_SMS_BASE_URL;
    const headers = {
      Authorization: `Bearer ${config.zenderApiKey}`,
      Accept: 'application/json',
    };

    try {
      await axios.get(`${baseUrl}/api/v1/me`, { headers, timeout: 10000 });
      return true;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401) {
        throw new Error('Invalid Romdix SMS API Key.');
      }
      // If the key has SMS permissions without account.view, fall back to SMS listing.
      if (status === 403) {
        try {
          await axios.get(`${baseUrl}/api/v1/messages`, {
            headers,
            params: { channel: 'sms' },
            timeout: 10000,
          });
          return true;
        } catch (smsError: any) {
          if (smsError?.response?.status === 401) {
            throw new Error('Invalid Romdix SMS API Key.');
          }
          if (smsError?.response?.status === 403) {
            throw new Error('Romdix SMS API Key is missing SMS/Account permissions or API Access on the plan.');
          }
          throw new Error(formatZenderError(smsError, 'Romdix SMS connection test failed.'));
        }
      }
      throw new Error(formatZenderError(error, 'Could not reach Romdix SMS server.'));
    }
  }

  extractMessageId(result: any): string | null {
    const id = result?.data?.id ?? result?.id;
    return id !== undefined && id !== null && String(id).trim() !== '' ? String(id) : null;
  }

  async getStatus(messageId: string, config: any): Promise<ProviderDeliveryStatus> {
    if (!config?.zenderApiKey) {
      throw new Error('Romdix SMS API Key missing.');
    }
    const baseUrl = ROMDIX_SMS_BASE_URL;
    const response = await axios.get(`${baseUrl}/api/v1/messages/${encodeURIComponent(messageId)}`, {
      headers: {
        Authorization: `Bearer ${config.zenderApiKey}`,
        Accept: 'application/json',
      },
      timeout: 15000,
    });
    const rawStatus = response.data?.data?.status ?? response.data?.status;
    return mapZenderStatus(rawStatus);
  }
}
