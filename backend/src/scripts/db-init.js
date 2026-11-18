/**
 * Installation hors Docker : crée les tables dans la base indiquée par DATABASE_URL.
 *   npm run db:init            → schéma seul
 *   npm run db:init -- --demo  → schéma + données de démonstration
 *   Sur une base existante : applique les mises à jour (02-schema-v2.sql).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/init');

async function run(file) {
  const sql = await fs.readFile(path.join(dir, file), 'utf8');
  await pool.query(sql);
  console.log(`✔ ${file}`);
}

try {
  const exists = await pool.query(`SELECT to_regclass('public.users') AS t`);
  if (exists.rows[0].t) {
    // Base existante : applique la mise à jour v2 (sans risque si déjà faite)
    await run('02-schema-v2.sql');
  } else {
    await run('01-schema.sql');
    await run('02-schema-v2.sql');
    if (process.argv.includes('--demo')) await run('03-demo.sql');
  }
} catch (err) {
  console.error('Échec :', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
