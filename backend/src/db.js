import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] erreur de connexion inattendue :', err.message);
});

/** Exécute une requête et renvoie les lignes. */
export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

/** Renvoie la première ligne, ou null. */
export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

/** Exécute fn(client) dans une transaction. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
