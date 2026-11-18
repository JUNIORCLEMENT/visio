import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Contact, Meeting } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Avatar } from '../../shared/avatar';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-contacts-page',
  imports: [FormsModule, Avatar, Icon],
  template: `
    <div class="page-head">
      <div>
        <h1>Contacts</h1>
        <p class="page-sub">Appelez un collègue en vidéo directement depuis la liste.</p>
      </div>
      <div class="head-right">
        <span class="online-count">
          <span class="online-dot"></span>
          {{ onlineCount() }} en ligne
        </span>
        <div class="search-wrap">
          <svg class="search-ico" viewBox="0 0 20 20" fill="none">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.4"/>
            <path d="M15 15l-3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <input class="search-inp" [(ngModel)]="search" (ngModelChange)="onSearch()"
            placeholder="Nom, service, site…" aria-label="Rechercher un contact" />
        </div>
      </div>
    </div>

    @if (loading()) {
      <div class="loading-state"><span class="spin"></span> Chargement…</div>
    } @else if (!contacts().length) {
      <div class="empty-state">
        <svg viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="22" r="12" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 56c0-13.255 10.745-24 24-24s24 10.745 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <p>{{ search ? 'Aucun résultat' : 'Aucun collègue disponible' }}</p>
        <span>{{ search ? 'Essayez un autre terme.' : 'Les collègues ayant un compte apparaîtront ici.' }}</span>
      </div>
    } @else {
      <div class="contacts-grid">
        @for (c of contacts(); track c.id) {
          <div class="contact-card">
            <div class="card-top">
              <span class="av-wrap">
                <app-avatar [name]="c.fullName" size="m" />
                <span class="presence" [class.on]="c.online"></span>
              </span>
              <div class="contact-info">
                <h3>{{ c.fullName }}</h3>
                <p class="contact-role">{{ join(c.jobTitle, c.department) || '—' }}</p>
                @if (c.site || c.company) {
                  <p class="contact-loc">{{ join(c.site, c.company) }}</p>
                }
              </div>
            </div>
            <div class="card-foot">
              <span class="status-label" [class.on]="c.online">
                <span class="status-dot" [class.on]="c.online"></span>
                {{ c.online ? 'En ligne' : 'Hors ligne' }}
              </span>
              <button class="btn-call" type="button" (click)="call(c)"
                [disabled]="calling() === c.id" [attr.aria-label]="'Appeler ' + c.fullName">
                @if (calling() === c.id) {
                  <span class="spin-sm"></span>
                } @else {
                  <svg viewBox="0 0 20 20" fill="none">
                    <path d="M4.167 3.333h3.5l1.75 4.375-2.188 1.313a9.167 9.167 0 0 0 4.167 4.166l1.312-2.187 4.375 1.75v3.5a1.167 1.167 0 0 1-1.167 1.167C6.25 17.417 2.583 13.75 2.583 9.167c0-.645.522-1.167 1.167-1.167l.417-4.667Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                }
                Appeler
              </button>
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

    .head-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

    .online-count {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      background: #f0fdf4; color: #166534;
      font-size: 12px; font-weight: 600;
    }
    .online-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #22c55e;
      animation: pulse 1.6s ease infinite;
    }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }

    .search-wrap { position: relative; display: flex; align-items: center; }
    .search-ico {
      position: absolute; left: 11px;
      width: 15px; height: 15px; color: var(--faint);
      pointer-events: none;
    }
    .search-inp {
      height: 40px; padding: 0 14px 0 34px;
      border-radius: 12px; border: 1.5px solid var(--line);
      background: var(--panel); color: var(--ink);
      font-size: 13px; outline: none; width: 240px;
      transition: border-color .12s, box-shadow .12s;
    }
    .search-inp:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(43,15,134,.08); }

    /* États */
    .loading-state { display: flex; align-items: center; gap: 10px; color: var(--faint); font-size: 13px; }
    .empty-state {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 60px 20px; text-align: center;
    }
    .empty-state svg { width: 56px; height: 56px; color: var(--line); }
    .empty-state p { font-size: 16px; font-weight: 600; color: var(--muted); margin: 0; }
    .empty-state span { font-size: 13px; color: var(--faint); }

    /* Grille */
    .contacts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px;
    }

    .contact-card {
      background: var(--shell);
      border: 1.5px solid var(--line);
      border-radius: 18px;
      padding: 16px;
      display: flex; flex-direction: column; gap: 14px;
      transition: border-color .15s, box-shadow .15s;
    }
    .contact-card:hover {
      border-color: rgba(43,15,134,.2);
      box-shadow: 0 4px 16px rgba(43,15,134,.06);
    }

    .card-top { display: flex; align-items: flex-start; gap: 12px; }
    .av-wrap { position: relative; flex: none; }
    .presence {
      position: absolute; right: 1px; bottom: 1px;
      width: 11px; height: 11px; border-radius: 50%;
      background: var(--faint); border: 2px solid var(--shell);
    }
    .presence.on { background: #22c55e; }

    .contact-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .contact-info h3 { font-size: 14px; font-weight: 700; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .contact-role { font-size: 12px; color: var(--muted); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .contact-loc { font-size: 11px; color: var(--faint); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .status-label {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 12px; color: var(--faint); font-weight: 500;
    }
    .status-label.on { color: #16a34a; }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); flex: none; }
    .status-dot.on { background: #22c55e; }

    .btn-call {
      display: inline-flex; align-items: center; gap: 7px;
      height: 36px; padding: 0 14px;
      border-radius: 10px; border: none;
      background: var(--blue); color: #fff;
      font-size: 13px; font-weight: 600;
      cursor: pointer;
      transition: background .12s;
    }
    .btn-call:hover:not(:disabled) { background: var(--brand); }
    .btn-call:disabled { opacity: .5; cursor: not-allowed; }
    .btn-call svg { width: 15px; height: 15px; }

    .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--blue); animation: spin .7s linear infinite; flex: none; }
    .spin-sm { width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 600px) {
      .contacts-grid { grid-template-columns: 1fr; }
      .search-inp { width: 100%; }
    }
  `,
})
export class ContactsPage implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly contacts = signal<Contact[]>([]);
  protected readonly loading = signal(true);
  protected readonly calling = signal<string | null>(null);
  protected search = '';
  protected join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');
  protected onlineCount = () => this.contacts().filter(c => c.online).length;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setInterval>;

  async ngOnInit() {
    await this.load();
    this.refreshTimer = setInterval(() => this.load(), 30_000);
  }
  ngOnDestroy() { clearInterval(this.refreshTimer); clearTimeout(this.searchTimer); }

  onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 250);
  }

  async load() {
    try {
      const r = await this.api.get<{ contacts: Contact[] }>(`/api/contacts?search=${encodeURIComponent(this.search)}`);
      this.contacts.set(r.contacts);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async call(c: Contact) {
    this.calling.set(c.id);
    try {
      const r = await this.api.post<{ meeting: Meeting }>('/api/calls', { userId: c.id });
      await this.router.navigate(['/reunion', r.meeting.code]);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.calling.set(null);
    }
  }
}
