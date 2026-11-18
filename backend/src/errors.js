import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new HttpError(400, msg, extra);
export const unauthorized = (msg = 'Connexion requise.') => new HttpError(401, msg);
export const forbidden = (msg = 'Accès refusé.') => new HttpError(403, msg);
export const notFound = (msg = 'Introuvable.') => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

/** Valide req.body / req.query avec un schéma zod et renvoie les données propres. */
export function parse(schema, data) {
  const res = schema.safeParse(data ?? {});
  if (!res.success) {
    const first = res.error.issues[0];
    throw badRequest(first?.message || 'Données invalides.', {
      fields: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return res.data;
}

// Middleware Express : dernier de la chaîne
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Données invalides.' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps de requête JSON invalide.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Envoi trop volumineux.' });
  }
  console.error('[api] erreur', req.method, req.originalUrl, err);
  return res.status(500).json({ error: 'Erreur interne. Réessayez ou contactez la DSID.' });
}
