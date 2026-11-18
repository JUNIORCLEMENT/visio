import nodemailer from 'nodemailer';
import { config } from '../config.js';

/**
 * Envoi des e-mails vers les boîtes HPO Mail.
 * - SMTP_HOST renseigné : envoi réel par le serveur SMTP de HPO Mail (ou Mailpit en dev).
 * - SMTP_HOST vide : les e-mails sont affichés dans la console et gardés en mémoire
 *   (outbox) pour le développement et les tests.
 */
export const outbox = [];

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      tls: { rejectUnauthorized: config.smtp.rejectUnauthorized },
    })
  : nodemailer.createTransport({ jsonTransport: true });

export const mailMode = config.smtp.host ? 'smtp' : 'console';

export async function sendMail({ to, subject, html, text }) {
  const info = await transport.sendMail({ from: config.smtp.from, to, subject, html, text });
  if (mailMode === 'console') {
    outbox.push({ to, subject, text, html, at: new Date() });
    if (outbox.length > 50) outbox.shift();
    if (config.env !== 'test') {
      console.log(`\n[mail] (mode console) À : ${to}\n[mail] Objet : ${subject}\n${text}\n`);
    }
  }
  return info;
}

let lastCheck = { at: 0, status: 'unknown' };
/** Vérifie la connexion SMTP (mise en cache 60 s) pour le tableau de bord. */
export async function smtpStatus() {
  if (mailMode === 'console') return 'console';
  if (Date.now() - lastCheck.at < 60_000) return lastCheck.status;
  let status = 'down';
  try {
    await Promise.race([
      transport.verify(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ]);
    status = 'ok';
  } catch {
    status = 'down';
  }
  lastCheck = { at: Date.now(), status };
  return status;
}

// ---------------------------------------------------------------------
// Modèles d'e-mails
// ---------------------------------------------------------------------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ROLE_LABELS = { admin: 'Administrateur', organizer: 'Organisateur', user: 'Utilisateur' };
export const roleLabel = (r) => ROLE_LABELS[r] ?? r;

export function formatDateFr(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    timeZone: process.env.TZ || 'Africa/Libreville',
  }).format(new Date(date));
}

function layout(title, bodyHtml, footer) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#ECEAF4;font-family:Segoe UI,Arial,sans-serif;color:#16131F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="background:#20036F;color:#FFFFFF;padding:18px 24px;font-size:18px;font-weight:600">HPO Visio</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;background:#F5F4FA;color:#625D72;font-size:12px;line-height:1.5">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (url, label) =>
  `<p style="margin:22px 0"><a href="${esc(url)}" style="display:inline-block;background:#2B0F86;color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${esc(label)}</a></p>
<p style="font-size:12px;color:#625D72;word-break:break-all">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${esc(url)}</p>`;

const SAFETY = 'Vous n’attendiez pas cet e-mail ? Ignorez-le ou signalez-le à la DSID. HPO Visio ne vous demandera jamais votre mot de passe par e-mail.';

export function invitationEmail({ firstName, role, url, expiresAt }) {
  const subject = 'Activez votre compte HPO Visio';
  const html = layout(
    subject,
    `<p>Bonjour ${esc(firstName)},</p>
<p>La DSID vous a ouvert un accès à <b>HPO Visio</b>, l’outil de réunions vidéo du Groupe, avec le rôle <b>${esc(roleLabel(role))}</b>.</p>
<p>Votre compte sera créé à partir de vos informations HPO Mail. Il vous suffit de confirmer.</p>
${button(url, 'Activer mon compte')}
<p>Ce lien est personnel et ne fonctionne qu’une fois. Il expire le ${esc(formatDateFr(expiresAt))}.</p>`,
    SAFETY,
  );
  const text = `Bonjour ${firstName},

La DSID vous a ouvert un accès à HPO Visio, avec le rôle ${roleLabel(role)}.
Votre compte sera créé à partir de vos informations HPO Mail.

Activer mon compte : ${url}

Ce lien est personnel et ne fonctionne qu’une fois. Il expire le ${formatDateFr(expiresAt)}.

${SAFETY}`;
  return { subject, html, text };
}

export function loginCodeEmail({ firstName, code }) {
  const subject = `Votre code de connexion HPO Visio : ${code}`;
  const html = layout(
    'Code de connexion',
    `<p>Bonjour ${esc(firstName)},</p>
<p>Voici votre code pour terminer la connexion à HPO Visio :</p>
<p style="font-size:30px;letter-spacing:8px;font-weight:700;margin:18px 0">${esc(code)}</p>
<p>Il est valable 10 minutes. Si vous n’êtes pas à l’origine de cette connexion, changez votre mot de passe et prévenez la DSID.</p>`,
    SAFETY,
  );
  const text = `Bonjour ${firstName},\n\nVotre code de connexion HPO Visio : ${code}\nValable 10 minutes.\n\n${SAFETY}`;
  return { subject, html, text };
}

export function passwordResetEmail({ firstName, url }) {
  const subject = 'Réinitialisation de votre mot de passe HPO Visio';
  const html = layout(
    'Nouveau mot de passe',
    `<p>Bonjour ${esc(firstName)},</p>
<p>Une demande de réinitialisation du mot de passe HPO Visio a été faite pour votre compte.</p>
${button(url, 'Choisir un nouveau mot de passe')}
<p>Ce lien est valable 1 heure et ne fonctionne qu’une fois.</p>`,
    SAFETY,
  );
  const text = `Bonjour ${firstName},\n\nChoisir un nouveau mot de passe : ${url}\nLien valable 1 heure.\n\n${SAFETY}`;
  return { subject, html, text };
}

export function meetingInviteEmail({ firstName, organizer, title, start, code, url }) {
  const when = start ? formatDateFr(start) : 'dès maintenant';
  const subject = `Réunion : ${title}`;
  const html = layout(
    title,
    `<p>Bonjour ${esc(firstName)},</p>
<p>${esc(organizer)} vous convie à la réunion <b>${esc(title)}</b>, ${esc(when)}.</p>
<p>Code de la réunion : <b>${esc(code)}</b></p>
${button(url, 'Rejoindre la réunion')}`,
    'Connectez-vous avec vos identifiants habituels pour rejoindre la réunion.',
  );
  const text = `Bonjour ${firstName},\n\n${organizer} vous convie à la réunion « ${title} », ${when}.\nCode : ${code}\nRejoindre : ${url}`;
  return { subject, html, text };
}

export function meetingReminderEmail({ firstName, title, start, code, url, minutes }) {
  const subject = `Rappel : « ${title} » commence dans ${minutes} minutes`;
  const html = layout(
    `Votre réunion commence dans ${minutes} minutes`,
    `<p>Bonjour ${esc(firstName)},</p>
<p>La réunion <b>${esc(title)}</b> commence à <b>${esc(formatDateFr(start).split(' ').slice(-1)[0])}</b>.</p>
<p>Code de la réunion : <b>${esc(code)}</b></p>
${button(url, 'Rejoindre la réunion')}
<p style="font-size:12px;color:#625D72">Les réunions HPO Visio sont enregistrées et conservées par la DSID.</p>`,
    'Vous recevez ce rappel parce que vous êtes convié à cette réunion.',
  );
  const text = `Bonjour ${firstName},\n\nLa réunion « ${title} » commence dans ${minutes} minutes (${formatDateFr(start)}).\nCode : ${code}\nRejoindre : ${url}\n\nLes réunions HPO Visio sont enregistrées et conservées par la DSID.`;
  return { subject, html, text };
}

export function missedCallEmail({ firstName, callerName, at, url }) {
  const subject = `Appel manqué de ${callerName}`;
  const html = layout(
    'Appel manqué',
    `<p>Bonjour ${esc(firstName)},</p><p>${esc(callerName)} a essayé de vous joindre sur HPO Visio le ${esc(formatDateFr(at))}.</p>${button(url, 'Ouvrir mes contacts')}`,
    'Notification automatique HPO Visio.',
  );
  const text = `Bonjour ${firstName},\n\n${callerName} a essayé de vous joindre sur HPO Visio le ${formatDateFr(at)}.\n${url}`;
  return { subject, html, text };
}
