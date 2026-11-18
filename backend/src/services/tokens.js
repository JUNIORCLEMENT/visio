import crypto from 'node:crypto';

/** Jeton aléatoire URL-safe (256 bits par défaut). */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Empreinte SHA-256 en hexadécimal : seule forme stockée en base. */
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Comparaison à temps constant de deux empreintes hexadécimales. */
export function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

/** Code à 6 chiffres pour la double authentification. */
export function sixDigitCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Code de réunion lisible : hpo-123-456 */
export function meetingCode() {
  const part = () => String(crypto.randomInt(100, 1000));
  return `hpo-${part()}-${part()}`;
}
