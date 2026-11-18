import 'dotenv/config';

const str = (name, fallback = '') => (process.env[name] ?? fallback).toString().trim();
const bool = (name, fallback = false) => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'oui', 'on'].includes(v.toLowerCase());
};
const int = (name, fallback) => {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
};
const list = (name, fallback = '') =>
  str(name, fallback).split(',').map((s) => s.trim()).filter(Boolean);

const env = str('NODE_ENV', 'development');

export const config = {
  env,
  isProd: env === 'production',
  port: int('PORT', 3000),
  appUrl: str('APP_URL', 'http://localhost:4200').replace(/\/$/, ''),
  trustProxy: bool('TRUST_PROXY', true),

  databaseUrl: str('DATABASE_URL', 'postgres://hpo:hpo@localhost:5432/hpo_visio'),

  session: {
    secret: str('SESSION_SECRET'),
    hours: int('SESSION_HOURS', 10),
    cookieName: 'hv_session',
    secureCookie: bool('COOKIE_SECURE', env === 'production'),
  },

  // Adresses autorisées (domaines HPO Mail), ex. « hpo-groupe.com,tryam.ga » — « * » = tous les domaines
  mailDomains: list('HPO_MAIL_DOMAINS', 'hpo-groupe.com').map((d) => d.toLowerCase()),
  mailDomainsOpen: list('HPO_MAIL_DOMAINS', 'hpo-groupe.com').map((d) => d.toLowerCase()).includes('*'),

  // --- Branchement HPO Mail ---------------------------------------------
  directoryProvider: str('DIRECTORY_PROVIDER', 'db').toLowerCase(), // db | ldap
  authProvider: str('AUTH_PROVIDER', 'local').toLowerCase(), // local | ldap | imap

  smtp: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: str('SMTP_USER'),
    pass: str('SMTP_PASSWORD'),
    from: str('MAIL_FROM', 'HPO Visio <no-reply@hpo-groupe.com>'),
    rejectUnauthorized: bool('SMTP_TLS_REJECT_UNAUTHORIZED', true),
  },

  ldap: {
    url: str('LDAP_URL'),
    bindDn: str('LDAP_BIND_DN'),
    bindPassword: str('LDAP_BIND_PASSWORD'),
    baseDn: str('LDAP_BASE_DN'),
    mailAttribute: str('LDAP_ATTR_MAIL', 'mail'),
    attrs: {
      fullName: str('LDAP_ATTR_NAME', 'displayName'),
      department: str('LDAP_ATTR_DEPARTMENT', 'department'),
      jobTitle: str('LDAP_ATTR_TITLE', 'title'),
      site: str('LDAP_ATTR_SITE', 'physicalDeliveryOfficeName'),
      company: str('LDAP_ATTR_COMPANY', 'company'),
    },
    rejectUnauthorized: bool('LDAP_TLS_REJECT_UNAUTHORIZED', true),
  },

  imap: {
    host: str('IMAP_HOST'),
    port: int('IMAP_PORT', 993),
    secure: bool('IMAP_SECURE', true),
    // « email » : se connecter avec l'adresse complète ; « localpart » : avec la partie avant @
    loginFormat: str('IMAP_LOGIN_FORMAT', 'email'),
    rejectUnauthorized: bool('IMAP_TLS_REJECT_UNAUTHORIZED', true),
  },

  livekit: {
    // URL interne utilisée par l'API pour piloter LiveKit (http://livekit:7880 en Docker)
    apiUrl: str('LIVEKIT_API_URL', 'http://localhost:7880'),
    // URL que les navigateurs utilisent (ws:// ou wss://). Vide = même origine que le site (proxy /rtc).
    publicUrl: str('LIVEKIT_PUBLIC_URL'),
    apiKey: str('LIVEKIT_API_KEY', 'devkey'),
    apiSecret: str('LIVEKIT_API_SECRET', 'secret'),
  },

  // Enregistrements : dossier partagé avec le service LiveKit Egress
  recording: {
    // Dossier où l'API lit les fichiers (volume Docker monté sur /recordings)
    dir: str('RECORDINGS_DIR', './recordings'),
    // Même dossier, vu depuis le conteneur Egress
    egressDir: str('EGRESS_OUTPUT_DIR', '/out'),
    layout: str('RECORDING_LAYOUT', 'grid'),
  },

  // Rappel envoyé avant le début d'une réunion (Activité + e-mail HPO Mail)
  reminderMinutes: int('REMINDER_MINUTES', 10),
  // Durée de la sonnerie d'un appel avant « appel manqué »
  callRingSeconds: int('CALL_RING_SECONDS', 45),
  // Tâches planifiées (rappels, appels manqués, nettoyage des enregistrements)
  schedulerEnabled: bool('SCHEDULER_ENABLED', true),

  // Réseaux considérés comme « Réseau interne » (journaux, double authentification)
  internalNetworks: list('INTERNAL_NETWORKS', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8'),

  bootstrapAdmin: {
    email: str('BOOTSTRAP_ADMIN_EMAIL').toLowerCase(),
    name: str('BOOTSTRAP_ADMIN_NAME', 'Administrateur HPO Visio'),
    password: str('BOOTSTRAP_ADMIN_PASSWORD'),
  },
};

export function assertConfig() {
  const errors = [];
  if (!config.session.secret || config.session.secret.length < 32) {
    errors.push('SESSION_SECRET doit contenir au moins 32 caractères (openssl rand -hex 32).');
  }
  if (!['db', 'ldap'].includes(config.directoryProvider)) {
    errors.push('DIRECTORY_PROVIDER doit valoir « db » ou « ldap ».');
  }
  if (!['local', 'ldap', 'imap'].includes(config.authProvider)) {
    errors.push('AUTH_PROVIDER doit valoir « local », « ldap » ou « imap ».');
  }
  if ((config.directoryProvider === 'ldap' || config.authProvider === 'ldap') && (!config.ldap.url || !config.ldap.baseDn)) {
    errors.push('LDAP_URL et LDAP_BASE_DN sont obligatoires avec le fournisseur ldap.');
  }
  if (config.authProvider === 'imap' && !config.imap.host) {
    errors.push('IMAP_HOST est obligatoire avec AUTH_PROVIDER=imap.');
  }
  if (config.isProd && (config.livekit.apiSecret === 'secret' || config.livekit.apiSecret.length < 32)) {
    errors.push('LIVEKIT_API_SECRET doit contenir au moins 32 caractères en production (openssl rand -hex 32).');
  }
  if (config.mailDomains.length === 0) errors.push('HPO_MAIL_DOMAINS est vide.');
  if (errors.length) {
    const msg = 'Configuration invalide :\n - ' + errors.join('\n - ');
    throw new Error(msg);
  }
}
