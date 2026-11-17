import axios from 'axios';
import { storage, InstallationRecord } from './storage';

const API_VERSION = '2021-07-28';

// Read at call time: dotenv may not have run when this module is first imported.
function apiDomain(): string {
  return process.env.GHL_API_DOMAIN || 'https://services.leadconnectorhq.com';
}

export class GhlApiError extends Error {
  status?: number;
  body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'GhlApiError';
    this.status = status;
    this.body = body;
  }
}

async function refreshInstallation(locationId: string): Promise<InstallationRecord | null> {
  const record = storage.getInstallation(locationId);
  if (!record?.refresh_token) return null;

  const form = new URLSearchParams({
    client_id: process.env.GHL_APP_CLIENT_ID || '',
    client_secret: process.env.GHL_APP_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
    refresh_token: record.refresh_token,
  });

  try {
    const response = await axios.post(`${apiDomain()}/oauth/token`, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const updated: InstallationRecord = {
      ...record,
      ...response.data,
      locationId: response.data.locationId || record.locationId || locationId,
    };
    storage.saveInstallation(locationId, updated);
    return updated;
  } catch (error: any) {
    console.error('[GHL] Token refresh failed:', error?.response?.status, error?.message);
    return null;
  }
}

async function request<T>(
  locationId: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  data?: unknown,
  params?: Record<string, string>
): Promise<T> {
  let record = storage.getInstallation(locationId);
  if (!record?.access_token) {
    throw new GhlApiError('No installation token for this sub-account', 401);
  }

  const call = (token: string) =>
    axios.request<T>({
      method,
      baseURL: apiDomain(),
      url: path,
      data,
      params,
      timeout: 20000,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: API_VERSION,
        'Content-Type': 'application/json',
      },
    });

  try {
    return (await call(record.access_token)).data;
  } catch (error: any) {
    if (error?.response?.status === 401) {
      const refreshed = await refreshInstallation(locationId);
      if (refreshed?.access_token) {
        return (await call(refreshed.access_token)).data;
      }
    }
    throw new GhlApiError(
      `HighLevel API ${method} ${path} failed (${error?.response?.status || 'no response'}): ${
        error?.response?.data?.message || error?.message || 'unknown error'
      }`,
      error?.response?.status,
      error?.response?.data
    );
  }
}

/** PUT /conversations/messages/:messageId/status */
export async function updateMessageStatus(
  locationId: string,
  messageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  error?: { code?: string; type?: string; message?: string }
): Promise<void> {
  if (!messageId) return;
  const body: Record<string, unknown> = { status };
  if (error) {
    body.error = {
      code: error.code || 'provider_error',
      type: error.type || 'provider',
      message: error.message || 'Message delivery failed',
    };
  }
  await request(locationId, 'PUT', `/conversations/messages/${encodeURIComponent(messageId)}/status`, body);
}

/** GET /contacts/lookup?locationId=...&phone=... */
export async function lookupContactByPhone(
  locationId: string,
  phone: string
): Promise<{ id: string } | null> {
  const data = await request<any>(locationId, 'GET', '/contacts/lookup', undefined, {
    locationId,
    phone,
  });
  const contact = data?.contacts?.[0];
  return contact?.id ? { id: contact.id } : null;
}

/** POST /conversations/messages/inbound */
export async function addInboundMessage(
  locationId: string,
  payload: { contactId?: string; conversationId?: string; message: string; attachments?: string[]; date?: string }
): Promise<{ messageId?: string; conversationId?: string }> {
  const conversationProviderId = process.env.GHL_CONVERSATION_PROVIDER_ID;
  if (!conversationProviderId) {
    throw new GhlApiError('GHL_CONVERSATION_PROVIDER_ID is not configured', 500);
  }
  return request(locationId, 'POST', '/conversations/messages/inbound', {
    type: 'SMS',
    conversationProviderId,
    direction: 'inbound',
    message: payload.message,
    contactId: payload.contactId,
    conversationId: payload.conversationId,
    attachments: payload.attachments,
    date: payload.date,
  });
}
