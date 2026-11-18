import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { directory } from './directory/index.js';
import { invitationEmail, sendMail } from './mailer.js';
import { randomToken, sha256 } from './tokens.js';

/** Statut affiché : une invitation en attente dont la date est passée est « expirée ». */
export function displayStatus(inv) {
  if (inv.status === 'pending' && new Date(inv.expires_at) < new Date()) return 'expired';
  return inv.status;
}

export function serializeInvitation(inv) {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    status: displayStatus(inv),
    expiresAt: inv.expires_at,
    createdAt: inv.created_at,
    acceptedAt: inv.accepted_at,
    invitedBy: inv.invited_by_name ?? null,
    fullName: inv.full_name ?? null,
  };
}

/**
 * Crée une invitation et envoie l'e-mail sur la boîte HPO Mail.
 * Toute invitation encore en attente pour la même adresse est remplacée
 * (son lien cesse de fonctionner).
 */
export async function createAndSendInvitation({ email, role, ttlHours, invitedBy, profile }) {
  const token = randomToken();
  const inv = await tx(async (c) => {
    await c.query(`UPDATE invitations SET status = 'replaced' WHERE email = $1 AND status = 'pending'`, [email]);
    const { rows } = await c.query(
      `INSERT INTO invitations (email, role, token_hash, ttl_hours, expires_at, invited_by)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $4), $5) RETURNING *`,
      [email, role, sha256(token), ttlHours, invitedBy],
    );
    return rows[0];
  });

  const url = `${config.appUrl}/invitation/${token}`;
  const firstName = (profile?.fullName || email).split(/[ .@]/)[0];
  try {
    await sendMail({ to: email, ...invitationEmail({ firstName, role, url, expiresAt: inv.expires_at }) });
  } catch (err) {
    // L'e-mail n'est pas parti : on annule l'invitation pour ne pas laisser un lien fantôme
    await query(`UPDATE invitations SET status = 'revoked' WHERE id = $1`, [inv.id]);
    throw new Error(`Envoi de l’e-mail impossible (${err.message}).`);
  }
  return inv;
}

/**
 * Lit une invitation à partir du jeton reçu dans le lien.
 * Renvoie { state, invitation, profile } avec state ∈ ok | unknown | expired | used | revoked | replaced
 */
export async function inspectToken(token) {
  if (!token || token.length < 20 || token.length > 200) return { state: 'unknown' };
  const inv = await one('SELECT * FROM invitations WHERE token_hash = $1', [sha256(token)]);
  if (!inv) return { state: 'unknown' };
  const s = displayStatus(inv);
  if (s === 'accepted') return { state: 'used', invitation: inv };
  if (s !== 'pending') return { state: s, invitation: inv };
  const profile = await directory.findByEmail(inv.email);
  if (!profile) return { state: 'not_in_directory', invitation: inv };
  return { state: 'ok', invitation: inv, profile };
}
