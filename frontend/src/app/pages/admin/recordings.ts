import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { fmtBytes, fmtDateTime, fmtDuration } from '../../core/labels';
import { Recording } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

interface RecordingsResponse {
  recordings: Recording[];
  totals: { count: number; bytes: number; active: number; failed: number };
  retentionDays: number;
  enabled: boolean;
}

/** Admin › Enregistrements : toutes les réunions et tous les appels enregistrés, conservés par la DSID. */
@Component({
  selector: 'app-admin-recordings',
  imports: [FormsModule, RouterLink, Icon],
  template: `
    @if (data(); as d) {
      <div class="stats">
        <div class="card stat"><span class="k">Enregistrements</span><span class="v">{{ d.totals.count }}</span>
          <span class="sub">{{ d.totals.active }} en cours</span></div>
        <div class="card stat"><span class="k">Espace utilisé</span><span class="v">{{ bytes(d.totals.bytes) }}</span>
          <span class="sub">sur le serveur de la DSID</span></div>
        <div class="card stat"><span class="k">Conservation</span><span class="v">{{ d.retentionDays }} j</span>
          <span class="sub">suppression automatique ensuite</span></div>
        <div class="card stat"><span class="k">Échecs</span><span class="v">{{ d.totals.failed }}</span>
          <span class="sub" [class.warn-text]="d.totals.failed > 0">{{ d.totals.failed ? 'à vérifier (service Egress)' : 'aucun' }}</span></div>
      </div>
      @if (!d.enabled) {
        <div class="alert warn">L’enregistrement automatique est désactivé (onglet Sécurité). Les nouvelles réunions ne sont plus enregistrées.</div>
      }
    }

    <section class="card stack">
      <div class="between">
        <div>
          <h2>Appels et réunions enregistrés</h2>
          <p class="sub">Accessible uniquement aux administrateurs DSID. Chaque téléchargement et suppression est inscrit au journal.</p>
        </div>
        <div class="row wrap">
          <div class="tabs" role="tablist" aria-label="Type">
            @for (k of kinds; track k.id) {
              <button type="button" role="tab" [class.on]="kind() === k.id" [attr.aria-selected]="kind() === k.id" (click)="kind.set(k.id); load()">{{ k.label }}</button>
            }
          </div>
          <label class="sr-only" for="rec-search">Rechercher</label>
          <input id="rec-search" class="input search" [(ngModel)]="search" (ngModelChange)="onSearch()" placeholder="Titre, code, organisateur…" />
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Titre</th><th>Organisateur</th><th>Durée</th><th>Taille</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            @for (r of data()?.recordings ?? []; track r.id) {
              <tr>
                <td class="nowrap">{{ date(r.startedAt) }}</td>
                <td><span class="pill" [class.info]="r.kind === 'call'">{{ r.kind === 'call' ? 'Appel' : 'Réunion' }}</span></td>
                <td><b>{{ r.title }}</b><br /><span class="hint mono">{{ r.roomName }}</span></td>
                <td>{{ r.organizerName ?? '—' }}</td>
                <td>{{ r.durationSeconds ? dur(r.durationSeconds) : '—' }}</td>
                <td>{{ r.sizeBytes ? bytes(r.sizeBytes) : '—' }}</td>
                <td>
                  @switch (r.status) {
                    @case ('recording') { <span class="pill live"><span class="dot"></span>En cours</span> }
                    @case ('ready') { <span class="pill ok">Disponible</span> }
                    @default { <span class="pill off" [attr.title]="r.error">Échec</span> }
                  }
                </td>
                <td class="acts">
                  @if (r.available) {
                    <button class="mini primary" type="button" (click)="playing.set(r)"><app-icon name="play" [size]="14" /> Lire</button>
                    <a class="mini" [href]="'/api/admin/recordings/' + r.id + '/file?download=1'" download><app-icon name="download" [size]="14" /></a>
                  }
                  @if (r.sessionId) { <a class="mini" [routerLink]="['/comptes-rendus', r.sessionId]" title="Compte rendu"><app-icon name="doc" [size]="14" /></a> }
                  @if (r.status !== 'recording') {
                    <button class="mini danger" type="button" (click)="remove(r)" aria-label="Supprimer"><app-icon name="trash" [size]="14" /></button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="8" class="empty">Aucun enregistrement pour l’instant.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (playing(); as p) {
      <div class="overlay" (click)="playing.set(null)">
        <div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="h-play" (click)="$event.stopPropagation()">
          <div class="between">
            <div><h2 id="h-play">{{ p.title }}</h2><p class="sub">{{ date(p.startedAt) }} · {{ dur(p.durationSeconds ?? 0) }}</p></div>
            <button class="icon-btn" type="button" (click)="playing.set(null)" aria-label="Fermer"><app-icon name="close" /></button>
          </div>
          <video class="player" controls autoplay [src]="'/api/admin/recordings/' + p.id + '/file'"></video>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .stat { display: flex; flex-direction: column; gap: 4px; }
    .k { color: var(--muted); font-size: 13px; }
    .v { font-size: 28px; font-weight: 600; }
    .warn-text { color: var(--orange); }
    .wrap { flex-wrap: wrap; }
    .search { width: 240px; height: 42px; }
    .nowrap { white-space: nowrap; }
    .acts { white-space: nowrap; }
    .acts .mini { display: inline-flex; align-items: center; gap: 4px; margin-right: 4px; text-decoration: none; }
    .player { width: 100%; max-height: 70vh; background: #000; border-radius: 16px; }
  `,
})
export class AdminRecordings implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly data = signal<RecordingsResponse | null>(null);
  protected readonly kind = signal<'' | 'meeting' | 'call'>('');
  protected readonly playing = signal<Recording | null>(null);
  protected readonly kinds: { id: '' | 'meeting' | 'call'; label: string }[] = [
    { id: '', label: 'Tout' },
    { id: 'meeting', label: 'Réunions' },
    { id: 'call', label: 'Appels' },
  ];
  protected readonly date = fmtDateTime;
  protected readonly dur = fmtDuration;
  protected readonly bytes = fmtBytes;
  protected search = '';
  private timer?: ReturnType<typeof setTimeout>;
  private refresh?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.load();
    this.refresh = setInterval(() => this.load(), 20_000);
  }

  ngOnDestroy() {
    clearInterval(this.refresh);
    clearTimeout(this.timer);
  }

  onSearch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 250);
  }

  async load() {
    try {
      this.data.set(await this.api.get<RecordingsResponse>(`/api/admin/recordings?kind=${this.kind()}&search=${encodeURIComponent(this.search)}`));
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  async remove(r: Recording) {
    if (!confirm(`Supprimer définitivement l’enregistrement « ${r.title} » ?`)) return;
    try {
      await this.api.delete(`/api/admin/recordings/${r.id}`);
      this.toasts.show('Enregistrement supprimé.');
      await this.load();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }
}
