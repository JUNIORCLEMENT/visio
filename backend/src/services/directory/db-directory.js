import { parse } from 'csv-parse/sync';
import { one, query, tx } from '../../db.js';
import { config } from '../../config.js';

/**
 * Annuaire HPO Mail stocké dans PostgreSQL (table directory_entries),
 * alimenté par import CSV. Fonctionne quel que soit le serveur HPO Mail.
 */
export const dbDirectory = {
  name: 'db',

  async findByEmail(email) {
    const row = await one(
      `SELECT email, full_name, department, job_title, site, company
         FROM directory_entries WHERE email = $1 AND active`,
      [email.toLowerCase()],
    );
    return row
      ? {
          email: row.email,
          fullName: row.full_name,
          department: row.department,
          jobTitle: row.job_title,
          site: row.site,
          company: row.company,
        }
      : null;
  },

  async status() {
    const r = await one('SELECT count(*)::int AS n, max(updated_at) AS last FROM directory_entries WHERE active');
    return { ok: r.n > 0, entries: r.n, lastUpdate: r.last };
  },
};

// Correspondance des en-têtes CSV acceptés (insensible à la casse et aux accents)
const HEADER_ALIASES = {
  email: ['email', 'e-mail', 'mail', 'adresse', 'adresse mail', 'adresse e-mail', 'courriel'],
  fullName: ['nom complet', 'nom_complet', 'full_name', 'fullname', 'nom', 'displayname', 'nom et prenom', 'nom prenom'],
  department: ['service', 'departement', 'department', 'direction'],
  jobTitle: ['fonction', 'poste', 'job_title', 'title', 'titre'],
  site: ['site', 'localisation', 'ville', 'office'],
  company: ['filiale', 'societe', 'company', 'entreprise'],
};

const normalize = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function mapHeaders(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const n = normalize(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] === undefined && aliases.includes(n)) map[field] = idx;
    }
  });
  return map;
}

/**
 * Importe un CSV (séparateur ; ou ,) dans directory_entries.
 * Colonnes minimales : email, nom complet. Facultatives : service, fonction, site, filiale.
 * Option deactivateMissing : désactive les adresses absentes du fichier (import complet).
 */
export async function importDirectoryCsv(csvText, { deactivateMissing = false } = {}) {
  const text = csvText.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = parse(text, { delimiter, skip_empty_lines: true, trim: true, relax_column_count: true });
  if (rows.length < 2) throw new Error('Le fichier ne contient pas de données.');

  const map = mapHeaders(rows[0]);
  if (map.email === undefined || map.fullName === undefined) {
    throw new Error('Colonnes obligatoires introuvables : « email » et « nom complet ».');
  }

  const result = { total: rows.length - 1, imported: 0, skipped: [], deactivated: 0 };
  const seen = new Set();
  const domains = config.mailDomains;
  const domainsOpen = config.mailDomainsOpen;

  await tx(async (client) => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const email = String(r[map.email] ?? '').trim().toLowerCase();
      const fullName = String(r[map.fullName] ?? '').trim();
      const line = i + 1;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        result.skipped.push({ line, reason: `adresse invalide « ${email} »` });
        continue;
      }
      if (!domainsOpen && !domains.includes(email.split('@')[1])) {
        result.skipped.push({ line, reason: `domaine non autorisé (${email})` });
        continue;
      }
      if (!fullName) {
        result.skipped.push({ line, reason: `nom manquant (${email})` });
        continue;
      }
      const val = (f) => (map[f] !== undefined ? String(r[map[f]] ?? '').trim() || null : null);
      await client.query(
        `INSERT INTO directory_entries (email, full_name, department, job_title, site, company, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, department = EXCLUDED.department,
           job_title = EXCLUDED.job_title, site = EXCLUDED.site, company = EXCLUDED.company, active = true`,
        [email, fullName, val('department'), val('jobTitle'), val('site'), val('company')],
      );
      seen.add(email);
      result.imported++;
    }
    if (deactivateMissing && seen.size > 0) {
      const res = await client.query(
        'UPDATE directory_entries SET active = false WHERE active AND NOT (email = ANY($1::text[]))',
        [[...seen]],
      );
      result.deactivated = res.rowCount;
    }
  });
  return result;
}

export async function listDirectory(search = '', limit = 50) {
  const s = `%${search.toLowerCase()}%`;
  return query(
    `SELECT email, full_name, department, job_title, site, company
       FROM directory_entries
      WHERE active AND (lower(full_name) LIKE $1 OR email LIKE $1)
      ORDER BY full_name LIMIT $2`,
    [s, limit],
  );
}
