import bcrypt from 'bcryptjs';
import { ImapFlow } from 'imapflow';
import { InvalidCredentialsError } from 'ldapts';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { ldapFindEntry, newLdapClient } from './directory/ldap-directory.js';

/**
 * Vérification des mots de passe, selon AUTH_PROVIDER :
 *   local → mot de passe propre à HPO Visio (haché en bcrypt dans users.password_hash),
 *           choisi par le collaborateur à l'activation de son compte.
 *   ldap  → mot de passe HPO Mail vérifié par une connexion LDAP (bind).
 *   imap  → mot de passe HPO Mail vérifié par une connexion IMAP à la messagerie.
 */
export const passwordMode = config.authProvider === 'local' ? 'create' : 'verify';

const DUMMY_HASH = bcrypt.hashSync('hpo-visio-dummy-password', 10);

export function checkPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Le mot de passe doit contenir au moins 10 caractères.';
  }
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return null;
}

export const hashPassword = (pwd) => bcrypt.hash(pwd, 12);

const serviceDown = () =>
  new HttpError(503, 'La vérification du mot de passe HPO Mail est indisponible. Réessayez dans un instant.');

async function verifyLdap(email, password) {
  let entry;
  try {
    entry = await ldapFindEntry(email);
  } catch (err) {
    console.error('[ldap] recherche impossible :', err.message);
    throw serviceDown();
  }
  if (!entry) return false;
  const client = newLdapClient();
  try {
    await client.bind(entry.dn, password);
    return true;
  } catch (err) {
    if (err instanceof InvalidCredentialsError) return false;
    console.error('[ldap] bind impossible :', err.message);
    throw serviceDown();
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function verifyImap(email, password) {
  const user = config.imap.loginFormat === 'localpart' ? email.split('@')[0] : email;
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user, pass: password },
    logger: false,
    tls: { rejectUnauthorized: config.imap.rejectUnauthorized },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
  });
  // Empêche une erreur réseau tardive de faire tomber le processus
  client.on('error', () => {});
  try {
    await client.connect();
    await client.logout().catch(() => {});
    return true;
  } catch (err) {
    if (err?.authenticationFailed || /auth/i.test(err?.responseText ?? '')) return false;
    console.error('[imap] connexion impossible :', err.message);
    throw serviceDown();
  }
}

/**
 * Vérifie le mot de passe d'une personne.
 * @param {string} email
 * @param {string} password
 * @param {string|null} passwordHash  (mode local uniquement)
 */
export async function verifyPassword(email, password, passwordHash = null) {
  if (!password) return false;
  switch (config.authProvider) {
    case 'ldap':
      return verifyLdap(email, password);
    case 'imap':
      return verifyImap(email, password);
    default:
      // Comparaison factice si pas de hash : même durée de réponse, pas d'indice
      return bcrypt.compare(password, passwordHash || DUMMY_HASH).then((ok) => ok && !!passwordHash);
  }
}
