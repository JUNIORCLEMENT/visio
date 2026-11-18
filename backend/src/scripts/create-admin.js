/**
 * Crée (ou promeut) un administrateur, sans passer par une invitation.
 *   npm run create-admin -- prenom.nom@hpo-groupe.com "Prénom Nom"
 * En mode AUTH_PROVIDER=local, le mot de passe est lu dans ADMIN_PASSWORD.
 */
import { config } from '../config.js';
import { one, pool } from '../db.js';
import { directory } from '../services/directory/index.js';
import { checkPasswordPolicy, hashPassword } from '../services/passwords.js';

const [email, name] = process.argv.slice(2);
if (!email) {
  console.error('Usage : npm run create-admin -- adresse@hpo-groupe.com "Prénom Nom"');
  process.exit(1);
}

try {
  let hash = null;
  if (config.authProvider === 'local') {
    const pwd = process.env.ADMIN_PASSWORD;
    const policy = checkPasswordPolicy(pwd);
    if (policy) throw new Error(`ADMIN_PASSWORD : ${policy}`);
    hash = await hashPassword(pwd);
  }
  const p = await directory.findByEmail(email).catch(() => null);
  const u = await one(
    `INSERT INTO users (email, full_name, department, job_title, site, company, role, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7)
     ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'active',
       password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash)
     RETURNING email, full_name`,
    [email.toLowerCase(), p?.fullName ?? name ?? email, p?.department ?? null, p?.jobTitle ?? null, p?.site ?? null, p?.company ?? null, hash],
  );
  console.log(`✔ Administrateur : ${u.full_name} <${u.email}>`);
} catch (err) {
  console.error('Échec :', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
