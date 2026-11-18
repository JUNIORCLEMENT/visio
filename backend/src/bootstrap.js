import { config } from './config.js';
import { one } from './db.js';
import { directory } from './services/directory/index.js';
import { checkPasswordPolicy, hashPassword } from './services/passwords.js';

/**
 * Crée le premier administrateur au démarrage s'il n'en existe aucun.
 * Les comptes suivants sont créés par invitation depuis l'écran Admin.
 */
export async function ensureAdmin({ email, name, password } = config.bootstrapAdmin, log = console.log) {
  const exists = await one(`SELECT count(*)::int AS n FROM users WHERE role = 'admin'`);
  if (exists.n > 0) return null;
  if (!email) {
    log('[démarrage] Aucun administrateur : renseignez BOOTSTRAP_ADMIN_EMAIL (ou lancez « npm run create-admin »).');
    return null;
  }
  let passwordHash = null;
  if (config.authProvider === 'local') {
    const policy = checkPasswordPolicy(password);
    if (policy) {
      log(`[démarrage] Administrateur non créé : BOOTSTRAP_ADMIN_PASSWORD invalide. ${policy}`);
      return null;
    }
    passwordHash = await hashPassword(password);
  }
  let profile = null;
  try {
    profile = await directory.findByEmail(email);
  } catch {
    /* annuaire indisponible : on garde le nom fourni */
  }
  const user = await one(
    `INSERT INTO users (email, full_name, department, job_title, site, company, role, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7)
     ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'active',
       password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash)
     RETURNING id, email, full_name`,
    [
      email.toLowerCase(),
      profile?.fullName ?? name,
      profile?.department ?? 'Informatique',
      profile?.jobTitle ?? null,
      profile?.site ?? null,
      profile?.company ?? null,
      passwordHash,
    ],
  );
  log(`[démarrage] Administrateur créé : ${user.email}`);
  return user;
}
