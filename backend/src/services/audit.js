import { query } from '../db.js';
import { clientIp, originLabel } from './network.js';

/**
 * Ajoute une ligne au journal d'activité (écran Admin > Journaux).
 * N'interrompt jamais la requête en cas d'échec.
 */
export async function audit(req, action, { actor, target = null, details = null } = {}) {
  const who = actor ?? req?.user ?? null;
  const label = who?.full_name ?? who?.label ?? 'Inconnu';
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, actor_label, action, target, details, ip, origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        who?.id && !who?.isGuest ? who.id : null,
        label,
        action,
        target,
        details ? JSON.stringify(details) : null,
        req ? clientIp(req) : null,
        req ? originLabel(req) : null,
      ],
    );
  } catch (err) {
    console.error('[audit] écriture impossible :', err.message);
  }
}
