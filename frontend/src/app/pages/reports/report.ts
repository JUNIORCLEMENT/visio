import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { fmtDay, fmtDuration, fmtTime } from '../../core/labels';
import { ReportDetail } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Avatar } from '../../shared/avatar';
import { Icon } from '../../shared/icon';

/** Fiche de compte rendu : données automatiques + notes de l'organisateur + export Word. */
@Component({
  selector: 'app-report-page',
  imports: [FormsModule, RouterLink, Avatar, Icon],
  template: `
    @if (error()) {
      <section class="card stack"><h1>Compte rendu introuvable</h1><p class="sub">{{ error() }}</p>
        <a routerLink="/comptes-rendus">Retour aux comptes rendus</a></section>
    } @else if (r(); as r) {
      <section class="card between">
        <div class="grow">
          <a routerLink="/comptes-rendus" class="hint">← Comptes rendus</a>
          <div class="row wrap"><span class="pill" [class.info]="r.meeting.kind === 'call'">{{ r.meeting.kind === 'call' ? 'Appel' : 'Réunion' }}</span>
            <h1>{{ r.meeting.title }}</h1></div>
          <p class="sub cap">{{ day(r.startedAt) }} · {{ time(r.startedAt) }} – {{ r.endedAt ? time(r.endedAt) : 'en cours' }} · {{ dur(r.durationSeconds) }} · <span class="mono">{{ r.meeting.code }}</span></p>
        </div>
        <div class="row wrap">
          @if (auth.isAdmin() && recorded()) {
            <a class="btn ghost" routerLink="/admin" [queryParams]="{ onglet: 'enregistrements' }"><app-icon name="rec" /> Enregistrement</a>
          }
          <a class="btn primary" [href]="'/api/reports/' + r.id + '/docx'" download><app-icon name="download" /> Exporter en Word</a>
        </div>
      </section>

      <div class="cols">
        <div class="stack">
          <section class="card stack">
            <div class="between">
              <h2>Notes du compte rendu</h2>
              @if (r.notesUpdatedBy) { <span class="hint">Modifié par {{ r.notesUpdatedBy }}, {{ day(r.notesUpdatedAt!) }} à {{ time(r.notesUpdatedAt!) }}</span> }
            </div>
            @if (r.meeting.agenda) {
              <div><span class="label">Ordre du jour</span><p class="pre">{{ r.meeting.agenda }}</p></div>
            }
            @if (r.canEdit) {
              <div class="field"><label for="n-notes">Résumé</label>
                <textarea id="n-notes" name="notes" [(ngModel)]="notes" rows="5" placeholder="Ce qui a été présenté et discuté…"></textarea></div>
              <div class="field"><label for="n-dec">Décisions</label>
                <textarea id="n-dec" name="decisions" [(ngModel)]="decisions" rows="4" placeholder="- Une décision par ligne"></textarea></div>
              <div class="field"><label for="n-act">Actions à mener</label>
                <textarea id="n-act" name="actions" [(ngModel)]="actions" rows="4" placeholder="- Qui fait quoi, pour quand"></textarea></div>
              <div class="row"><button class="btn primary" type="button" (click)="save()" [disabled]="saving()">Enregistrer les notes</button>
                <span class="hint">Une ligne commençant par « - » devient une puce dans le document Word.</span></div>
            } @else {
              <div><span class="label">Résumé</span><p class="pre">{{ r.notes || 'Pas encore rédigé par l’organisateur.' }}</p></div>
              <div><span class="label">Décisions</span><p class="pre">{{ r.decisions || '—' }}</p></div>
              <div><span class="label">Actions à mener</span><p class="pre">{{ r.actions || '—' }}</p></div>
            }
          </section>

          <section class="card stack">
            <h2>Discussion pendant la réunion <span class="sub">({{ r.messages.length }})</span></h2>
            @for (m of r.messages; track $index) {
              <div class="msg"><span class="hint">{{ time(m.createdAt) }}</span> <b>{{ m.senderName }}</b> {{ m.body }}</div>
            } @empty { <p class="empty">Aucun message.</p> }
          </section>
        </div>

        <div class="stack">
          <section class="card stack">
            <h2>Informations</h2>
            <dl>
              <dt>Organisateur</dt><dd>{{ r.meeting.organizerName ?? '—' }}@if (r.meeting.organizerDepartment) { <span class="hint"> · {{ r.meeting.organizerDepartment }}</span> }</dd>
              <dt>Durée</dt><dd>{{ dur(r.durationSeconds) }}</dd>
              <dt>Enregistrement</dt><dd>{{ recorded() ? 'Oui — conservé par la DSID' : 'Non disponible' }}</dd>
            </dl>
          </section>
          <section class="card stack">
            <h2>Présents <span class="sub">({{ r.attendees.length }})</span></h2>
            @for (a of r.attendees; track a.identity) {
              <div class="person">
                <app-avatar [name]="a.name" />
                <div class="grow"><b class="ellipsis">{{ a.name }}</b><span class="hint ellipsis">{{ a.detail ?? '' }}</span></div>
                <span class="hint nowrap">{{ time(a.firstJoin) }}–{{ time(a.lastLeave) }}<br />{{ dur(a.seconds) }}</span>
              </div>
            } @empty { <p class="empty">Aucune présence enregistrée.</p> }
            @if (r.absent.length) {
              <h3 class="abs">Absents ({{ r.absent.length }})</h3>
              @for (a of r.absent; track a.name) { <div class="hint">{{ a.name }}@if (a.department) { · {{ a.department }} }</div> }
            }
          </section>
        </div>
      </div>
    } @else {
      <section class="card row"><span class="spin"></span><span class="sub">Chargement…</span></section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .wrap { flex-wrap: wrap; }
    .cap { text-transform: none; }
    .cols { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: 16px; align-items: start; }
    .pre { white-space: pre-wrap; margin-top: 4px; }
    .msg { padding: 8px 0; border-top: 1px solid var(--line); }
    .msg b { margin: 0 6px; }
    dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; }
    dt { color: var(--muted); font-size: 13px; }
    dd { margin: 0; }
    .person { display: flex; align-items: center; gap: 10px; }
    .person .grow { display: flex; flex-direction: column; }
    .nowrap { white-space: nowrap; text-align: right; }
    .abs { margin-top: 8px; }
    @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
  `,
})
export class ReportPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly auth = inject(Auth);
  readonly id = input.required<string>();

  protected readonly r = signal<ReportDetail | null>(null);
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  protected readonly day = (d: string) => fmtDay(d);
  protected readonly time = fmtTime;
  protected readonly dur = fmtDuration;
  protected notes = '';
  protected decisions = '';
  protected actions = '';

  protected recorded() {
    return !!this.r()?.recordings.some((x) => x.status === 'ready' || x.status === 'recording');
  }

  async ngOnInit() {
    try {
      const res = await this.api.get<{ report: ReportDetail }>(`/api/reports/${encodeURIComponent(this.id())}`);
      this.fill(res.report);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private fill(r: ReportDetail) {
    this.r.set(r);
    this.notes = r.notes ?? '';
    this.decisions = r.decisions ?? '';
    this.actions = r.actions ?? '';
  }

  async save() {
    this.saving.set(true);
    try {
      const res = await this.api.put<{ report: ReportDetail }>(`/api/reports/${this.id()}`, {
        notes: this.notes,
        decisions: this.decisions,
        actions: this.actions,
      });
      this.fill(res.report);
      this.toasts.show('Notes enregistrées. Elles figurent dans l’export Word.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
