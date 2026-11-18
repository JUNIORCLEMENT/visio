import { config } from '../../config.js';
import { dbDirectory } from './db-directory.js';
import { ldapDirectory } from './ldap-directory.js';

/**
 * Annuaire HPO Mail : point d'entrée unique, quel que soit le branchement.
 *   DIRECTORY_PROVIDER=db   → table PostgreSQL alimentée par import CSV
 *   DIRECTORY_PROVIDER=ldap → LDAP / Active Directory en direct
 *
 * Profil renvoyé : { email, fullName, department, jobTitle, site, company }
 */
export const directory = config.directoryProvider === 'ldap' ? ldapDirectory : dbDirectory;
