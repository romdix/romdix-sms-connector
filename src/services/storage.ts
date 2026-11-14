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

export const storage = {
  saveCredentials: (locationId: string, locationData: LocationStorage) => {
    const encrypted = CryptoJS.AES.encrypt(JSON.stringify(locationData), SECRET_KEY).toString();
    const stmt = db.prepare(`
      INSERT INTO locations (location_id, data_encrypted, updated_at)
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(location_id) DO UPDATE SET
        data_encrypted = excluded.data_encrypted,
        updated_at = excluded.updated_at
    `);
    stmt.run(locationId, encrypted);
  },

  getCredentials: (locationId: string): LocationStorage | null => {
    const row = db.prepare('SELECT data_encrypted FROM locations WHERE location_id = ?').get(locationId) as { data_encrypted: string } | undefined;
    if (!row) return null;

    try {
      const bytes = CryptoJS.AES.decrypt(row.data_encrypted, SECRET_KEY);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      const parsed = JSON.parse(decrypted);

      // Auto-migration: If it's a legacy flat structure (no 'providers' array)
      if (!parsed.providers) {
        const legacyId = 'legacy_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
        const providerType = parsed.providerType || 'icombd';
        let providerName = 'Migrated Provider';
        if (providerType === 'icombd') providerName = 'Icombd (Legacy)';
        if (providerType === 'revesms') providerName = 'Reve SMS (Legacy)';
        const migrated: LocationStorage = {
          defaultProviderId: legacyId,
          providers: [{ id: legacyId, type: providerType, name: providerName, config: { ...parsed } }]
        };
        return migrated;
      }

      return parsed as LocationStorage;
    } catch (e) {
      console.error('Error decrypting credentials:', e);
      return null;
    }
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
    return rows.map(r => r.location_id);
  }
};
