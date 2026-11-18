import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { forbidden, notFound, parse } from '../errors.js';
import { requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { buildReportDocx, reportFileName } from '../services/report-docx.js';
import { getReport, listReports } from '../services/reports.js';

/** Comptes rendus des réunions et appels. */
export const reportsRouter = Router();
reportsRouter.use(requireUser);

reportsRouter.get('/', async (req, res) => {
  res.json({ reports: await listReports(req.user, String(req.query.search ?? '')) });
});

reportsRouter.get('/:id', async (req, res) => {
  const r = await getReport(req.user, req.params.id);
  if (!r) throw notFound('Compte rendu introuvable.');
  res.json({ report: r });
});

const notesSchema = z.object({
  notes: z.string().max(20_000).nullable().optional(),
  decisions: z.string().max(20_000).nullable().optional(),
  actions: z.string().max(20_000).nullable().optional(),
});

reportsRouter.put('/:id', async (req, res) => {
  const r = await getReport(req.user, req.params.id);
  if (!r) throw notFound('Compte rendu introuvable.');
  if (!r.canEdit) throw forbidden('Seul l’organisateur (ou un administrateur) peut rédiger le compte rendu.');
  const body = parse(notesSchema, req.body);
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  await query(
    `UPDATE meeting_sessions SET notes = $2, decisions = $3, actions = $4, notes_updated_by = $5, notes_updated_at = now() WHERE id = $1`,
    [r.id, clean(body.notes), clean(body.decisions), clean(body.actions), req.user.id],
  );
  res.json({ report: await getReport(req.user, r.id) });
});

/** Export Word (.docx) pour les Docs de HPO Mail. */
reportsRouter.get('/:id/docx', async (req, res) => {
  const r = await getReport(req.user, req.params.id);
  if (!r) throw notFound('Compte rendu introuvable.');
  const buf = await buildReportDocx(r);
  const name = reportFileName(r);
  await audit(req, `Compte rendu exporté (Word) : « ${r.meeting.title} »`, { target: r.meeting.code });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(buf);
});
