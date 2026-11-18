import { Client, EqualityFilter } from 'ldapts';
import { config } from '../../config.js';

/**
 * Annuaire HPO Mail lu en direct dans LDAP / Active Directory.
 * Un compte de service (LDAP_BIND_DN) sert à chercher les personnes.
 */
export function newLdapClient() {
  // Les options TLS ne sont passées qu'en ldaps:// (sinon ldapts tente une connexion chiffrée)
  const secure = config.ldap.url.toLowerCase().startsWith('ldaps:');
  return new Client({
    url: config.ldap.url,
    timeout: 5000,
    connectTimeout: 5000,
    ...(secure ? { tlsOptions: { rejectUnauthorized: config.ldap.rejectUnauthorized } } : {}),
  });
}

const first = (v) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Cherche une entrée par adresse e-mail. Renvoie { dn, profile } ou null. */
export async function ldapFindEntry(email) {
  const { attrs, mailAttribute } = config.ldap;
  const client = newLdapClient();
  try {
    if (config.ldap.bindDn) await client.bind(config.ldap.bindDn, config.ldap.bindPassword);
    const { searchEntries } = await client.search(config.ldap.baseDn, {
      scope: 'sub',
      filter: new EqualityFilter({ attribute: mailAttribute, value: email.toLowerCase() }),
      attributes: [mailAttribute, ...Object.values(attrs)],
      sizeLimit: 2,
    });
    if (searchEntries.length !== 1) return null;
    const e = searchEntries[0];
    // Les noms d'attributs LDAP ne tiennent pas compte de la casse
    // (ldapts peut ajouter une entrée vide pour l'attribut demandé : on garde la valeur non vide)
    const lower = {};
    for (const [k, v] of Object.entries(e)) {
      const key = k.toLowerCase();
      const empty = v === undefined || v === null || (Array.isArray(v) && v.length === 0);
      if (!empty || !(key in lower)) lower[key] = v;
    }
    const get = (name) => {
      const v = first(lower[name.toLowerCase()]);
      return v === null || v === undefined ? null : String(v);
    };
    return {
      dn: e.dn,
      profile: {
        email: email.toLowerCase(),
        fullName: get(attrs.fullName) ?? email,
        department: get(attrs.department),
        jobTitle: get(attrs.jobTitle),
        site: get(attrs.site),
        company: get(attrs.company),
      },
    };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export const ldapDirectory = {
  name: 'ldap',

  async findByEmail(email) {
    const entry = await ldapFindEntry(email);
    return entry?.profile ?? null;
  },

  async status() {
    const client = newLdapClient();
    try {
      if (config.ldap.bindDn) await client.bind(config.ldap.bindDn, config.ldap.bindPassword);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      await client.unbind().catch(() => {});
    }
  },
};
