import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';

dotenv.config();

const SECRET_KEY = process.env.GHL_APP_CLIENT_SECRET || 'default_secret_key';
const DB_PATH = path.join(process.cwd(), 'data', 'connector.db');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database (auto-creates file if not exist)
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables if they don't exist (idempotent — safe to run every startup)
db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    location_id TEXT PRIMARY KEY,
    data_encrypted TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
  CREATE TABLE IF NOT EXISTS location_mappings (
    company_id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS installations (
    resource_id TEXT PRIMARY KEY,
    data_encrypted TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
  CREATE TABLE IF NOT EXISTS processed_messages (
    message_id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`);

console.log('[Storage] SQLite DB initialized:', DB_PATH);

// ---- Legacy JSON migration (runs once on startup if old files exist) ----
const LEGACY_CREDENTIALS_FILE = path.join(dataDir, 'credentials.json');
const LEGACY_MAPPINGS_FILE = path.join(dataDir, 'location-mappings.json');

if (fs.existsSync(LEGACY_CREDENTIALS_FILE)) {
  try {
    const content = JSON.parse(fs.readFileSync(LEGACY_CREDENTIALS_FILE, 'utf-8'));
    const insert = db.prepare('INSERT OR IGNORE INTO locations (location_id, data_encrypted) VALUES (?, ?)');
    for (const [locationId, encrypted] of Object.entries(content)) {
      insert.run(locationId, encrypted as string);
    }
    fs.renameSync(LEGACY_CREDENTIALS_FILE, LEGACY_CREDENTIALS_FILE + '.migrated');
    console.log('[Storage] Migrated legacy credentials.json to SQLite.');
  } catch (e) {
    console.error('[Storage] Failed to migrate legacy credentials.json:', e);
  }
}

if (fs.existsSync(LEGACY_MAPPINGS_FILE)) {
  try {
    const content = JSON.parse(fs.readFileSync(LEGACY_MAPPINGS_FILE, 'utf-8'));
    const insert = db.prepare('INSERT OR IGNORE INTO location_mappings (company_id, location_id) VALUES (?, ?)');
    for (const [companyId, locationId] of Object.entries(content)) {
      insert.run(companyId, locationId as string);
    }
    fs.renameSync(LEGACY_MAPPINGS_FILE, LEGACY_MAPPINGS_FILE + '.migrated');
    console.log('[Storage] Migrated legacy location-mappings.json to SQLite.');
  } catch (e) {
    console.error('[Storage] Failed to migrate legacy location-mappings.json:', e);
  }
}
// ---- End migration ----

export interface ConfiguredProvider {
  id: string;
  type: string;
  name: string;
  config: any;
}

export interface LocationStorage {
  defaultProviderId: string;
  providers: ConfiguredProvider[];
}

export interface InstallationRecord {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  userType?: string;
  companyId?: string;
  locationId?: string;
  expires_at?: number;
}

// Provider credentials that must never be returned to a browser.
const SECRET_FIELDS = ['apikey', 'secretkey', 'pass'];

function encrypt(data: unknown): string {
  return CryptoJS.AES.encrypt(JSON.stringify(data), SECRET_KEY).toString();
}

function decrypt<T>(payload: string): T {
  const bytes = CryptoJS.AES.decrypt(payload, SECRET_KEY);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8)) as T;
}

function maskProviderSecrets(data: LocationStorage): LocationStorage {
  return {
    ...data,
    providers: (data.providers || []).map((provider) => {
      const config: any = { ...(provider.config || {}) };
      const secretsSet: string[] = [];
      for (const field of SECRET_FIELDS) {
        if (config[field]) {
          secretsSet.push(field);
          config[field] = '';
        }
      }
      if (secretsSet.length) config.secretsSet = secretsSet;
      return { ...provider, config };
    }),
  };
}

export const storage = {
  saveCredentials: (locationId: string, locationData: LocationStorage) => {
    const previous = storage.getCredentialsRaw(locationId);
    const providers = (locationData.providers || []).map((provider) => {
      const old = previous?.providers?.find((p) => p.id === provider.id);
      const config: any = { ...(provider.config || {}) };
      // Empty secret fields mean "keep the stored value" (the browser never receives secrets).
      for (const field of SECRET_FIELDS) {
        if ((config[field] === '' || config[field] === null || typeof config[field] === 'undefined') && old?.config?.[field]) {
          config[field] = old.config[field];
        }
      }
      delete config.secretsSet;
      return { ...provider, config };
    });

    const toStore: LocationStorage = {
      defaultProviderId: locationData.defaultProviderId,
      providers,
    };

    const stmt = db.prepare(`
      INSERT INTO locations (location_id, data_encrypted, updated_at)
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(location_id) DO UPDATE SET
        data_encrypted = excluded.data_encrypted,
        updated_at = excluded.updated_at
    `);
    stmt.run(locationId, encrypt(toStore));
  },

  /** Raw credentials — server-side use only (sending SMS, testing a connection). */
  getCredentialsRaw: (locationId: string): LocationStorage | null => {
    const row = db.prepare('SELECT data_encrypted FROM locations WHERE location_id = ?').get(locationId) as { data_encrypted: string } | undefined;
    if (!row) return null;

    try {
      const parsed = decrypt<LocationStorage>(row.data_encrypted);

      // Auto-migration: If it's a legacy flat structure (no 'providers' array)
      if (!parsed.providers) {
        const legacyId = 'legacy_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
        const providerType = (parsed as any).providerType || 'icombd';
        let providerName = 'Migrated Provider';
        if (providerType === 'icombd') providerName = 'Icombd (Legacy)';
        if (providerType === 'revesms') providerName = 'Reve SMS (Legacy)';
        return {
          defaultProviderId: legacyId,
          providers: [{ id: legacyId, type: providerType, name: providerName, config: { ...(parsed as any) } }],
        };
      }

      return parsed;
    } catch (e) {
      console.error('Error decrypting credentials:', e);
      return null;
    }
  },

  /** Safe credentials for the browser — secret fields are blanked out. */
  getCredentials: (locationId: string): LocationStorage | null => {
    const raw = storage.getCredentialsRaw(locationId);
    return raw ? maskProviderSecrets(raw) : null;
  },

  deleteCredentials: (locationId: string) => {
    db.prepare('DELETE FROM locations WHERE location_id = ?').run(locationId);
  },

  saveInstallation: (resourceId: string, details: InstallationRecord) => {
    const record: InstallationRecord = { ...details };
    if (record.expires_in && !record.expires_at) {
      record.expires_at = Date.now() + record.expires_in * 1000;
    }
    const stmt = db.prepare(`
      INSERT INTO installations (resource_id, data_encrypted, updated_at)
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(resource_id) DO UPDATE SET
        data_encrypted = excluded.data_encrypted,
        updated_at = excluded.updated_at
    `);
    stmt.run(resourceId, encrypt(record));
  },

  getInstallation: (resourceId: string): InstallationRecord | null => {
    const row = db.prepare('SELECT data_encrypted FROM installations WHERE resource_id = ?').get(resourceId) as { data_encrypted: string } | undefined;
    if (!row) return null;
    try {
      return decrypt<InstallationRecord>(row.data_encrypted);
    } catch (e) {
      console.error('Error decrypting installation:', e);
      return null;
    }
  },

  deleteInstallation: (resourceId: string) => {
    db.prepare('DELETE FROM installations WHERE resource_id = ?').run(resourceId);
  },

  /** True when this GHL message id was already handled (webhook retry). */
  isMessageProcessed: (messageId: string): boolean => {
    const row = db.prepare('SELECT message_id FROM processed_messages WHERE message_id = ?').get(messageId);
    return !!row;
  },

  markMessageProcessed: (messageId: string) => {
    db.prepare('INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)').run(messageId);
  },

  saveLocationMapping: (companyId: string, locationId: string) => {
    const stmt = db.prepare(`
      INSERT INTO location_mappings (company_id, location_id) VALUES (?, ?)
      ON CONFLICT(company_id) DO UPDATE SET location_id = excluded.location_id
    `);
    stmt.run(companyId, locationId);
    console.log(`[Storage] Saved location mapping: ${companyId} -> ${locationId}`);
  },

  getLocationMapping: (companyId: string): string | null => {
    const row = db.prepare('SELECT location_id FROM location_mappings WHERE company_id = ?').get(companyId) as { location_id: string } | undefined;
    return row?.location_id || null;
  },

  getAllConfiguredLocations: (): string[] => {
    const rows = db.prepare('SELECT location_id FROM locations').all() as { location_id: string }[];
    return rows.map((r) => r.location_id);
  },

  /** Uninstall: drop everything tied to a sub-account. */
  deleteLocationData: (locationId: string) => {
    storage.deleteCredentials(locationId);
    storage.deleteInstallation(locationId);
  },
};
