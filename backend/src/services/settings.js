import { query } from '../db.js';

export const SETTING_KEYS = {
  allow_guests: 'boolean',
  guest_waiting_room: 'boolean',
  admin_2fa: 'boolean',
  external_2fa: 'boolean',
  recording_allowed: 'boolean',
  recording_retention_days: 'number',
  invitation_default_ttl: 'number',
};

const DEFAULTS = {
  allow_guests: true,
  guest_waiting_room: true,
  admin_2fa: true,
  external_2fa: false,
  recording_allowed: true,
  recording_retention_days: 90,
  invitation_default_ttl: 72,
};

let cache = null;
let cacheAt = 0;

export async function getSettings() {
  if (cache && Date.now() - cacheAt < 10_000) return cache;
  const rows = await query('SELECT key, value FROM settings');
  const result = { ...DEFAULTS };
  for (const r of rows) if (r.key in SETTING_KEYS) result[r.key] = r.value;
  cache = result;
  cacheAt = Date.now();
  return result;
}

export async function updateSettings(patch, userId) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in SETTING_KEYS)) continue;
    await query(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), userId],
    );
  }
  cache = null;
  return getSettings();
}
