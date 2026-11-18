import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';
import { forbidden, unauthorized } from '../errors.js';

const ISSUER = 'hpo-visio';

// ---------------------------------------------------------------------
// Session des collaborateurs : jeton signé dans un cookie HttpOnly
// ---------------------------------------------------------------------
export function signSession(user) {
  return jwt.sign({ typ: 'session' }, config.session.secret, {
    subject: user.id,
    issuer: ISSUER,
    expiresIn: `${config.session.hours}h`,
  });
}

export function setSessionCookie(res, user) {
  res.cookie(config.session.cookieName, signSession(user), {
    httpOnly: true,
    secure: config.session.secureCookie,
    sameSite: 'strict',
    path: '/',
    maxAge: config.session.hours * 3600 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, {
    httpOnly: true,
    secure: config.session.secureCookie,
    sameSite: 'strict',
    path: '/',
  });
}

// ---------------------------------------------------------------------
// Jeton invité : limité à une réunion, transmis en en-tête Authorization
// ---------------------------------------------------------------------
export function signGuestToken({ guestId, meetingId, name }) {
  return jwt.sign({ typ: 'guest', mid: meetingId, name }, config.session.secret, {
    subject: guestId,
    issuer: ISSUER,
    expiresIn: '8h',
  });
}

/** Lit la session (cookie) ou le jeton invité (Bearer) et remplit req.user / req.guest. */
export async function loadIdentity(req, _res, next) {
  req.user = null;
  req.guest = null;

  const cookie = req.cookies?.[config.session.cookieName];
  if (cookie) {
    try {
      const payload = jwt.verify(cookie, config.session.secret, { issuer: ISSUER });
      if (payload.typ === 'session') {
        const user = await one(
          `SELECT id, email, full_name, department, job_title, site, company, role, status
             FROM users WHERE id = $1`,
          [payload.sub],
        );
        if (user && user.status === 'active') req.user = user;
      }
    } catch {
      /* cookie expiré ou invalide : traité comme non connecté */
    }
  }

  const auth = req.get('authorization') || '';
  if (!req.user && auth.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), config.session.secret, { issuer: ISSUER });
      if (payload.typ === 'guest') {
        const g = await one(`SELECT id, meeting_id, display_name, status FROM guest_requests WHERE id = $1`, [payload.sub]);
        if (g && g.status === 'admitted' && g.meeting_id === payload.mid) {
          req.guest = { id: g.id, meetingId: g.meeting_id, full_name: g.display_name, isGuest: true };
        }
      }
    } catch {
      /* jeton invité invalide */
    }
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('Cette action est réservée à : ' + roles.join(', ') + '.'));
    next();
  };
}

/** Données de l'utilisateur renvoyées au front. */
export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    department: u.department,
    jobTitle: u.job_title,
    site: u.site,
    company: u.company,
    role: u.role,
  };
}
