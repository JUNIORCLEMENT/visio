import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { fmtDay, fmtDuration, fmtTime } from '../../core/labels';
import { ReportSummary } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-reports-page',
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <div class="page-head">
      <div>
        <h1>Comptes rendus</h1>
        <p class="page-sub">Présents, durée, discussion et notes de chaque réunion ou appel.</p>
      </div>
      <div class="search-wrap">
        <svg class="search-ico" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M15 15l-3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <input class="search-inp" [(ngModel)]="search" (ngModelChange)="onSearch()"
          placeholder="Titre, code, organisateur…" aria-label="Rechercher" />
      </div>
    </div>

    @if (loading()) {
      <div class="loading-state"><span class="spin"></span> Chargement…</div>
    } @else if (!reports().length) {
      <div class="empty-state">
        <svg viewBox="0 0 64 64" fill="none">
          <rect x="10" y="6" width="44" height="52" rx="5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M20 20h24M20 30h24M20 40h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <p>Aucun compte rendu</p>
        <span>Ils apparaissent automatiquement après chaque réunion ou appel.</span>
      </div>
    } @else {
      <div class="report-list">
        @for (r of reports(); track r.id) {
          <div class="report-card">
            <!-- Date -->
            <div class="report-date">
              <span class="date-day">{{ dayNum(r.startedAt) }}</span>
              <span class="date-mon">{{ month(r.startedAt) }}</span>
            </div>

            <!-- Infos -->
            <div class="report-info">
              <div class="report-top">
                <span class="kind-badge" [class.call]="r.kind === 'call'">
                  {{ r.kind === 'call' ? '📞 Appel' : '📅 Réunion' }}
                </span>
                @if (r.recorded) {
                  <span class="rec-badge">
                    <app-icon name="rec" [size]="11" /> Enregistré
                  </span>
                }
              </div>
              <a class="report-title" [routerLink]="['/comptes-rendus', r.id]">{{ r.title }}</a>
              <p class="report-meta">
                {{ r.organizerName ?? '—' }} ·
                {{ time(r.startedAt) }}@if (r.endedAt) { – {{ time(r.endedAt) }} } ·
                <span class="mono">{{ r.code }}</span>
              </p>
            </div>

            <!-- Stats -->
            <div class="report-stats">
              <div class="stat-item">
                <span class="stat-val">{{ r.participants }}</span>
                <span class="stat-lbl">présents</span>
              </div>
              <div class="stat-item">
                <span class="stat-val">{{ r.endedAt ? dur(r) : '—' }}</span>
                <span class="stat-lbl">durée</span>
              </div>
            </div>

            <!-- Statut + actions -->
            <div class="report-right">
              <span class="notes-badge" [class.ok]="r.hasNotes">
                {{ r.hasNotes ? '✓ Rédigé' : 'À rédiger' }}
              </span>
              <div class="report-acts">
                <a class="btn-open" [routerLink]="['/comptes-rendus', r.id]">Ouvrir</a>
                <a class="btn-word" [href]="'/api/reports/' + r.id + '/docx'" download>
                  <app-icon name="download" [size]="14" /> Word
                </a>
              </div>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 20px; }

    /* En-tête */
    .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    h1 { font-size: 24px; font-weight: 800; letter-spacing: -.02em; margin: 0; }
    .page-sub { font-size: 13px; color: var(--muted); margin: 4px 0 0; }

    .search-wrap { position: relative; display: flex; align-items: center; }
    .search-ico { position: absolute; left: 11px; width: 15px; height: 15px; color: var(--faint); pointer-events: none; }
    .search-inp {
      height: 40px; padding: 0 14px 0 34px;
      border-radius: 12px; border: 1.5px solid var(--line);
      background: var(--panel); color: var(--ink);
      font-size: 13px; outline: none; width: 260px;
      transition: border-color .12s, box-shadow .12s;
    }
    .search-inp:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(43,15,134,.08); }

    /* États */
    .loading-state { display: flex; align-items: center; gap: 10px; color: var(--faint); font-size: 13px; }
    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 20px; text-align: center; }
    .empty-state svg { width: 56px; height: 56px; color: var(--line); }
    .empty-state p { font-size: 16px; font-weight: 600; color: var(--muted); margin: 0; }
    .empty-state span { font-size: 13px; color: var(--faint); }

    /* Liste */
    .report-list { display: flex; flex-direction: column; gap: 10px; }

    .report-card {
      display: flex; align-items: center; gap: 20px;
      padding: 16px 20px;
      background: var(--shell);
      border: 1.5px solid var(--line);
      border-radius: 18px;
      transition: border-color .12s, box-shadow .12s;
    }
    .report-card:hover { border-color: rgba(43,15,134,.2); box-shadow: 0 4px 16px rgba(43,15,134,.06); }

    /* Date */
    .report-date {
      flex: none; width: 48px;
      display: flex; flex-direction: column; align-items: center;
      background: var(--blue-soft); border-radius: 12px;
      padding: 8px 6px;
    }
    .date-day { font-size: 20px; font-weight: 800; color: var(--blue); line-height: 1; }
    .date-mon { font-size: 10px; font-weight: 600; color: var(--blue); text-transform: uppercase; letter-spacing: .05em; }

    /* Infos */
    .report-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .report-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .kind-badge {
      font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
      background: var(--blue-soft); color: var(--blue);
    }
    .kind-badge.call { background: #ede9fe; color: #6d28d9; }
    .rec-badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
      background: var(--red-soft); color: var(--red);
    }
    .report-title {
      font-size: 15px; font-weight: 700; color: var(--ink);
      text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .report-title:hover { color: var(--blue); text-decoration: underline; }
    .report-meta { font-size: 12px; color: var(--faint); margin: 0; }

    /* Stats */
    .report-stats { display: flex; gap: 20px; flex: none; }
    .stat-item { display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .stat-val { font-size: 16px; font-weight: 700; color: var(--ink); }
    .stat-lbl { font-size: 10px; color: var(--faint); text-transform: uppercase; letter-spacing: .05em; }

    /* Droite */
    .report-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex: none; }
    .notes-badge {
      font-size: 11.5px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
      background: var(--orange-soft); color: var(--orange);
    }
    .notes-badge.ok { background: var(--blue-soft); color: var(--blue); }
    .report-acts { display: flex; align-items: center; gap: 6px; }
    .btn-open {
      height: 32px; padding: 0 12px; border-radius: 9px;
      background: var(--blue); color: #fff;
      font-size: 12px; font-weight: 600; text-decoration: none;
      display: inline-flex; align-items: center;
      transition: background .12s;
    }
    .btn-open:hover { background: var(--brand); }
    .btn-word {
      height: 32px; padding: 0 10px; border-radius: 9px;
      border: 1.5px solid var(--line); background: transparent; color: var(--muted);
      font-size: 12px; font-weight: 500; text-decoration: none;
      display: inline-flex; align-items: center; gap: 4px;
      transition: border-color .12s, color .12s;
    }
    .btn-word:hover { border-color: var(--blue); color: var(--blue); }

    .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--blue); animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 760px) {
      .report-card { flex-wrap: wrap; gap: 12px; }
      .report-stats { display: none; }
      .report-right { flex-direction: row; align-items: center; width: 100%; justify-content: space-between; }
    }
  `,
})
export class ReportsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly reports = signal<ReportSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly time = fmtTime;
  protected search = '';
  private timer?: ReturnType<typeof setTimeout>;

  protected dayNum = (d: string) => new Date(d).getDate();
  protected month = (d: string) => new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(d));
  protected dur(r: ReportSummary) {
    return fmtDuration((new Date(r.endedAt!).getTime() - new Date(r.startedAt).getTime()) / 1000);
  }

  ngOnInit() { this.load(); }

  onSearch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 250);
  }

  async load() {
    try {
      const r = await this.api.get<{ reports: ReportSummary[] }>(`/api/reports?search=${encodeURIComponent(this.search)}`);
      this.reports.set(r.reports);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
