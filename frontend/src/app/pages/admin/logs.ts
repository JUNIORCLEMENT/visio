import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { fmtDateTime } from '../../core/labels';
import { AuditLog } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-admin-logs',
  imports: [FormsModule, Icon],
  template: `
    <section class="card stack">
      <div class="between">
        <h2>Journal d’activité</h2>
        <div class="row wrap">
          <label class="sr-only" for="l-search">Filtrer le journal</label>
          <input id="l-search" class="input search" [(ngModel)]="search" (ngModelChange)="onSearch()" placeholder="Filtrer : nom, action…" />
          <a class="btn ghost" href="/api/admin/logs.csv" download><app-icon name="download" /> Exporter (CSV)</a>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Cible</th><th>Origine</th></tr></thead>
          <tbody>
            @for (l of logs(); track l.id) {
              <tr>
                <td class="nowrap">{{ date(l.createdAt) }}</td>
                <td>{{ l.actor }}</td>
                <td>
                  @if (l.action.startsWith('Échec')) { <span class="pill off">{{ l.action }}</span> } @else { {{ l.action }} }
                </td>
                <td class="hint">{{ l.target ?? '' }}</td>
                <td><span class="pill" [class.info]="l.origin === 'Internet'">{{ l.origin ?? '—' }}</span></td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="empty">Aucune entrée.</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (more()) {
        <button class="btn ghost" type="button" (click)="load(true)">Afficher plus</button>
      }
    </section>
  `,
  styles: `.wrap { flex-wrap: wrap; } .search { width: 240px; height: 42px; } .nowrap { white-space: nowrap; }`,
})
export class AdminLogs implements OnInit {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly logs = signal<AuditLog[]>([]);
  protected readonly more = signal(false);
  protected readonly date = fmtDateTime;
  protected search = '';
  private timer?: ReturnType<typeof setTimeout>;
  private readonly page = 100;

  ngOnInit() {
    this.load();
  }

  onSearch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  async load(append = false) {
    const offset = append ? this.logs().length : 0;
    try {
      const r = await this.api.get<{ logs: AuditLog[] }>(
        `/api/admin/logs?limit=${this.page}&offset=${offset}&search=${encodeURIComponent(this.search)}`,
      );
      this.logs.set(append ? [...this.logs(), ...r.logs] : r.logs);
      this.more.set(r.logs.length === this.page);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }
}
