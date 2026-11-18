import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Api, errorMessage } from '../../core/api';
import { fmtRelative } from '../../core/labels';
import { AdminStats, Meeting } from '../../core/models';
import { Toasts } from '../../core/toast';

@Component({
  selector: 'app-admin-dashboard',
  template: `
    @if (stats(); as s) {
      <div class="stats">
        <div class="card stat"><span class="k">Réunions en cours</span><span class="v">{{ s.counts.liveMeetings }}</span><span class="sub">{{ s.counts.liveParticipants }} participant(s)</span></div>
        <div class="card stat"><span class="k">Comptes actifs</span><span class="v">{{ s.counts.usersActive }}</span><span class="sub">sur {{ s.counts.usersTotal }} comptes</span></div>
        <div class="card stat"><span class="k">Connectés depuis 24 h</span><span class="v">{{ s.counts.usersToday }}</span><span class="sub">collaborateurs</span></div>
        <div class="card stat"><span class="k">Invitations en attente</span><span class="v">{{ s.counts.invitationsPending }}</span>
          <span class="sub" [class.warn-text]="s.counts.failedLogins24h > 0">{{ s.counts.failedLogins24h }} échec(s) de connexion en 24 h</span></div>
      </div>

      <div class="grid">
        <section class="card stack services" aria-labelledby="h-svc">
          <div class="between"><h2 id="h-svc">État des services</h2>
            <button class="icon-btn" type="button" (click)="load()" aria-label="Actualiser">↻</button></div>
          <div class="svc"><span class="grow">Base de données PostgreSQL</span><span class="pill ok">Opérationnelle</span></div>
          <div class="svc"><span class="grow">Serveur vidéo LiveKit</span>
            <span class="pill" [class.ok]="s.services.livekit === 'ok'" [class.off]="s.services.livekit !== 'ok'">{{ s.services.livekit === 'ok' ? 'Opérationnel' : 'Injoignable' }}</span></div>
          <div class="svc"><span class="grow">Envoi des e-mails (HPO Mail)</span>
            <span class="pill" [class.ok]="s.services.smtp === 'ok'" [class.off]="s.services.smtp === 'down'" [class.warn]="s.services.smtp === 'console'">{{ smtpLabel() }}</span></div>
          <div class="svc"><span class="grow">Annuaire HPO Mail · {{ s.services.directory.provider === 'ldap' ? 'LDAP' : 'import CSV' }}</span>
            <span class="pill" [class.ok]="s.services.directory.ok" [class.warn]="!s.services.directory.ok">{{ directoryLabel() }}</span></div>
          <div class="svc"><span class="grow">Mots de passe</span><span class="pill info">{{ authLabel() }}</span></div>
          <div class="svc"><span class="grow">Enregistrements (24 h)</span>
            <span class="pill" [class.ok]="!s.counts.recordingsFailed7d" [class.warn]="s.counts.recordingsFailed7d > 0">
              {{ s.counts.recordings24h }}@if (s.counts.recordingsFailed7d) { · {{ s.counts.recordingsFailed7d }} échec(s) sur 7 j }
            </span></div>
        </section>

        <section class="card stack live" aria-labelledby="h-live">
          <h2 id="h-live">Réunions actives</h2>
          <div class="tablewrap">
            <table>
              <thead><tr><th>Réunion</th><th>Organisateur</th><th>Participants</th><th>Début</th><th></th></tr></thead>
              <tbody>
                @for (m of s.liveMeetings; track m.id) {
                  <tr>
                    <td>{{ m.title }} <span class="hint mono">{{ m.code }}</span></td>
                    <td>{{ m.organizerName ?? '—' }}</td>
                    <td>{{ m.participants }}</td>
                    <td>{{ rel(m.startedAt) }}</td>
                    <td><button class="mini danger" type="button" (click)="end(m)">Terminer</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="empty">Aucune réunion en cours.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    } @else {
      <div class="card row"><span class="spin"></span><span class="sub">Chargement…</span></div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .stat { display: flex; flex-direction: column; gap: 4px; }
    .k { color: var(--muted); font-size: 13px; }
    .v { font-size: 30px; font-weight: 600; }
    .warn-text { color: var(--orange); }
    .grid { display: flex; gap: 16px; flex-wrap: wrap; }
    .services { flex: 1 1 380px; }
    .live { flex: 999 1 460px; }
    .svc { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
  `,
})
export class AdminDashboard implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly rel = fmtRelative;
  private timer?: ReturnType<typeof setInterval>;

  protected readonly smtpLabel = computed(() => {
    const s = this.stats()?.services.smtp;
    return s === 'ok' ? 'Opérationnel' : s === 'console' ? 'Mode console (dév.)' : s === 'down' ? 'Injoignable' : 'Inconnu';
  });
  protected readonly directoryLabel = computed(() => {
    const d = this.stats()?.services.directory;
    if (!d) return '';
    if (d.provider === 'db') return d.ok ? `${d.entries} adresse(s)` : 'Vide : importez le CSV';
    return d.ok ? 'Connecté' : 'Injoignable';
  });
  protected readonly authLabel = computed(() => {
    const a = this.stats()?.services.authProvider;
    return a === 'ldap' ? 'HPO Mail (LDAP)' : a === 'imap' ? 'HPO Mail (IMAP)' : 'Propres à HPO Visio';
  });

  async ngOnInit() {
    await this.load();
    this.timer = setInterval(() => this.load(), 15_000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async load() {
    try {
      this.stats.set(await this.api.get<AdminStats>('/api/admin/stats'));
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  async end(m: Meeting) {
    if (!confirm(`Terminer « ${m.title} » pour tous les participants ?`)) return;
    try {
      await this.api.post(`/api/meetings/${m.code}/end`);
      this.toasts.show('Réunion terminée.');
      await this.load();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }
}
