import { Role } from './models';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  organizer: 'Organisateur',
  user: 'Utilisateur',
};

export const ROLES: Role[] = ['user', 'organizer', 'admin'];

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '?').replace(/\(.*\)/, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Couleur d'avatar stable pour un même nom (classes .c0 à .c5). */
export function avatarClass(seed: string | null | undefined): string {
  let h = 0;
  for (const ch of String(seed ?? '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return 'c' + (Math.abs(h) % 6);
}

const TZ = 'Africa/Libreville';

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(iso));
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso));
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date(iso));
}

/** « Aujourd'hui, 09:12 », « Hier, 17:30 » ou date courte. */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'Jamais';
  const d = new Date(iso);
  const dayKey = (x: Date) => new Intl.DateTimeFormat('fr-CA', { timeZone: TZ }).format(x);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (dayKey(d) === dayKey(today)) return `Aujourd’hui, ${fmtTime(iso)}`;
  if (dayKey(d) === dayKey(yesterday)) return `Hier, ${fmtTime(iso)}`;
  return fmtDateTime(iso);
}

/** Accepte « hpo-482-913 », « 482913 » ou « 482 913 » et renvoie hpo-482-913. */
export function normalizeMeetingCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 6 ? `hpo-${digits.slice(0, 3)}-${digits.slice(3)}` : null;
}

/** 3 h 05 · 52 min · 40 s */
export function fmtDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

export function fmtBytes(bytes: number | null | undefined): string {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} o`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} Ko`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} Mo`;
  return `${(b / 1024 ** 3).toFixed(2).replace('.', ',')} Go`;
}
