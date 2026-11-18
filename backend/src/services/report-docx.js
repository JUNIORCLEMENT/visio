import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

/**
 * Compte rendu au format Word (.docx), à déposer dans les Docs de HPO Mail.
 */
const LOGO = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/logo-hpo.png'));
const TZ = process.env.TZ || 'Africa/Libreville';
const BRAND = '20036F';
const MUTED = '625D72';
const LINE = 'E7E4F0';
const PANEL = 'F5F4FA';
const CONTENT_WIDTH = 9638; // A4, marges de 2 cm (en vingtièmes de point)

const fmt = (d, opts) => (d ? new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, ...opts }).format(new Date(d)) : '—');
const day = (d) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const time = (d) => fmt(d, { hour: '2-digit', minute: '2-digit' });
const duration = (s) => {
  const m = Math.round((s ?? 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text, width, { bold = false, fill = null, color = null } = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? '—'), bold, color: color ?? undefined, size: 20 })] })],
  });
}

function table(columns, rows, { header = true } = {}) {
  const widths = columns.map((c) => c.width);
  const out = [];
  if (header) out.push(new TableRow({ tableHeader: true, children: columns.map((c) => cell(c.label, c.width, { bold: true, fill: PANEL, color: MUTED })) }));
  for (const r of rows) out.push(new TableRow({ children: r.map((v, i) => cell(v, widths[i])) }));
  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, rows: out });
}

const h = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 120 }, children: [new TextRun(text)] });
const p = (text, opts = {}) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, size: 21, ...opts })] });

/** Texte libre saisi par l'organisateur : une ligne = un paragraphe (les tirets deviennent des puces). */
function freeText(text, placeholder) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [p(placeholder, { italics: true, color: MUTED })];
  return lines.map((l) =>
    /^[-•*]\s+/.test(l)
      ? new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: l.replace(/^[-•*]\s+/, ''), size: 21 })] })
      : p(l),
  );
}

export async function buildReportDocx(r) {
  const isCall = r.meeting.kind === 'call';
  const recorded = r.recordings.some((x) => x.status === 'ready' || x.status === 'recording');
  const labelW = 2600;

  const info = table(
    [
      { label: '', width: labelW },
      { label: '', width: CONTENT_WIDTH - labelW },
    ],
    [
      ['Date', day(r.startedAt)],
      ['Horaires', `${time(r.startedAt)} – ${r.endedAt ? time(r.endedAt) : 'en cours'}`],
      ['Durée', duration(r.durationSeconds)],
      ['Organisateur', [r.meeting.organizerName, r.meeting.organizerDepartment].filter(Boolean).join(' · ') || '—'],
      ['Code', r.meeting.code],
      ['Enregistrement', recorded ? 'Oui — conservé par la DSID' : 'Non disponible'],
    ],
    { header: false },
  );

  const attendeesTable = r.attendees.length
    ? table(
        [
          { label: 'Nom', width: 2700 },
          { label: 'Service / organisation', width: 2938 },
          { label: 'Arrivée', width: 1300 },
          { label: 'Départ', width: 1300 },
          { label: 'Présence', width: 1400 },
        ],
        r.attendees.map((a) => [a.name, a.detail ?? '—', time(a.firstJoin), time(a.lastLeave), duration(a.seconds)]),
      )
    : p('Aucune présence enregistrée.', { italics: true, color: MUTED });

  const children = [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: isCall ? 'COMPTE RENDU D’APPEL' : 'COMPTE RENDU DE RÉUNION', bold: true, size: 20, color: MUTED })],
    }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 240 }, children: [new TextRun(r.meeting.title)] }),
    info,
    h(`Participants (${r.attendees.length})`),
    attendeesTable,
  ];

  if (r.absent.length) {
    children.push(h(`Absents (${r.absent.length})`));
    for (const a of r.absent) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: a.department ? `${a.name} — ${a.department}` : a.name, size: 21 })] }));
    }
  }
  if (r.meeting.agenda) {
    children.push(h('Ordre du jour'), ...freeText(r.meeting.agenda, ''));
  }
  children.push(
    h('Résumé'),
    ...freeText(r.notes, 'À compléter par l’organisateur.'),
    h('Décisions'),
    ...freeText(r.decisions, 'Aucune décision consignée.'),
    h('Actions à mener'),
    ...freeText(r.actions, 'Aucune action consignée.'),
  );
  if (r.messages.length) {
    children.push(h('Discussion pendant la réunion'));
    for (const m of r.messages) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${time(m.createdAt)}  `, color: MUTED, size: 19 }),
            new TextRun({ text: `${m.senderName} : `, bold: true, size: 20 }),
            new TextRun({ text: m.body, size: 20 }),
          ],
        }),
      );
    }
  }
  if (r.notesUpdatedBy) {
    children.push(
      new Paragraph({
        spacing: { before: 360 },
        children: [new TextRun({ text: `Notes rédigées par ${r.notesUpdatedBy}, le ${day(r.notesUpdatedAt)} à ${time(r.notesUpdatedAt)}.`, italics: true, size: 18, color: MUTED })],
      }),
    );
  }

  const doc = new Document({
    creator: 'HPO Visio',
    title: `Compte rendu — ${r.meeting.title}`,
    description: 'Compte rendu généré par HPO Visio',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 21 } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 40, bold: true, color: BRAND, font: 'Calibri' } },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, color: BRAND, font: 'Calibri' },
          paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134, header: 567, footer: 567 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new ImageRun({ type: 'png', data: LOGO, transformation: { width: 150, height: 59 }, altText: { title: 'HPO & Associés', description: 'Logo HPO & Associés', name: 'logo' } })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `HPO Visio · ${r.meeting.code} · généré le ${fmt(new Date(), { dateStyle: 'short', timeStyle: 'short' })} · page `, size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
                  new TextRun({ text: ' / ', size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** Nom de fichier lisible : CR_2026-11-13_Point-hebdo.docx */
export function reportFileName(r) {
  const date = new Intl.DateTimeFormat('fr-CA', { timeZone: TZ }).format(new Date(r.startedAt));
  const slug = r.meeting.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `CR_${date}_${slug || r.meeting.code}.docx`;
}
