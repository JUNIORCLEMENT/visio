/**
 * Importe l'annuaire HPO Mail depuis un fichier CSV (DIRECTORY_PROVIDER=db).
 *
 *   npm run import:annuaire -- chemin/annuaire.csv           → ajoute / met à jour
 *   npm run import:annuaire -- chemin/annuaire.csv --complet → désactive aussi les adresses absentes du fichier
 *
 * Colonnes reconnues (séparateur ; ou ,) :
 *   email ; nom complet ; service ; fonction ; site ; filiale
 */
import fs from 'node:fs/promises';
import { pool } from '../db.js';
import { importDirectoryCsv } from '../services/directory/db-directory.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage : npm run import:annuaire -- chemin/annuaire.csv [--complet]');
  process.exit(1);
}

try {
  const text = await fs.readFile(file, 'utf8');
  const r = await importDirectoryCsv(text, { deactivateMissing: process.argv.includes('--complet') });
  console.log(`✔ ${r.imported} / ${r.total} lignes importées.`);
  if (r.deactivated) console.log(`  ${r.deactivated} adresse(s) désactivée(s) (absentes du fichier).`);
  for (const s of r.skipped) console.log(`  ✖ ligne ${s.line} : ${s.reason}`);
} catch (err) {
  console.error('Échec :', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
