import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { fmtRelative } from '../../core/labels';
import { LiveUpdates } from '../../core/live';
import { AppNotification, NotificationType } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

const ICONS: Record<NotificationType, string> = {
  meeting_invite: 'calendar',
  meeting_reminder: 'bell',
  incoming_call: 'phone',
  missed_call: 'missed',
  call_declined: 'phone',
};

const TYPE_LABELS: Record<NotificationType, string> = {
  meeting_invite: 'Convocation',
  meeting_reminder: 'Rappel',
  incoming_call: 'Appel',
  missed_call: 'Appel manqué',
  call_declined: 'Appel refusé',
};

@Component({
  selector: 'app-activity-page',
  imports: [Icon],
  template: `
    <div class="page-head">
      <div>
        <h1>Activité</h1>
        <p class="page-sub">Convocations, rappels 10 min avant vos réunions, appels manqués.</p>
      </div>
      <button class="btn-read-all" type="button" (click)="readAll()" [disabled]="!unread()">
        <svg viewBox="0 0 20 20" fill="none"><path d="M3.333 10l4.584 4.583 8.75-8.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Tout marquer lu
      </button>
    </div>

    @if (unread() > 0) {
      <div class="unread-bar">
        <span class="unread-dot"></span>
        {{ unread() }} notification{{ unread() > 1 ? 's' : '' }} non lue{{ unread() > 1 ? 's' : '' }}
      </div>
    }

    @if (loading()) {
      <div class="loading-state"><span class="spin"></span> Chargement…</div>
    } @else if (!items().length) {
      <div class="empty-state">
        <svg viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="1.5"/>
          <path d="M22 32a10 10 0 0 1 20 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="26" cy="27" r="1.5" fill="currentColor"/>
          <circle cx="38" cy="27" r="1.5" fill="currentColor"/>
        </svg>
        <p>Rien pour l'instant</p>
        <span>Vos convocations et rappels apparaîtront ici.</span>
      </div>
    } @else {
      <div class="notif-list">
        @for (n of items(); track n.id) {
          <button type="button" class="notif-item" [class.unread]="!n.read" (click)="open(n)">
            <span class="notif-ic {{ n.type }}">
              <app-icon [name]="icon(n.type)" [size]="18" />
            </span>
            <div class="notif-body">
              <div class="notif-top">
                <span class="notif-type-label">{{ typeLabel(n.type) }}</span>
                <span class="notif-time">{{ rel(n.createdAt) }}</span>
              </div>
              <p class="notif-title">{{ n.title }}</p>
              @if (n.body) { <p class="notif-desc">{{ n.body }}</p> }
            </div>
            @if (!n.read) { <span class="unread-mark" aria-label="Non lue"></span> }
          </button>
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

    .btn-read-all {
      display: inline-flex; align-items: center; gap: 7px;
      height: 38px; padding: 0 16px;
      border-radius: 10px; border: 1.5px solid var(--line);
      background: transparent; color: var(--muted);
      font-size: 13px; font-weight: 500; cursor: pointer;
      white-space: nowrap;
      transition: color .12s, border-color .12s;
    }
    .btn-read-all:hover:not(:disabled) { color: var(--blue); border-color: var(--blue); }
    .btn-read-all:disabled { opacity: .4; cursor: not-allowed; }
    .btn-read-all svg { width: 15px; height: 15px; }

    /* Barre non-lus */
    .unread-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; border-radius: 12px;
      background: var(--blue-soft); color: var(--blue);
      font-size: 13px; font-weight: 600;
    }
    .unread-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--blue); flex: none;
      animation: pulse 1.4s ease infinite;
    }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }

    /* États */
    .loading-state { display: flex; align-items: center; gap: 10px; color: var(--faint); font-size: 13px; padding: 20px 0; }
    .empty-state {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 60px 20px; text-align: center;
    }
    .empty-state svg { width: 56px; height: 56px; color: var(--line); }
    .empty-state p { font-size: 16px; font-weight: 600; color: var(--muted); margin: 0; }
    .empty-state span { font-size: 13px; color: var(--faint); }

    /* Liste */
    .notif-list { display: flex; flex-direction: column; gap: 6px; }

    .notif-item {
      display: flex; align-items: flex-start; gap: 14px;
      padding: 14px 16px;
      border-radius: 16px; border: 1.5px solid transparent;
      background: var(--shell);
      text-align: left; cursor: pointer; width: 100%;
      transition: border-color .12s, background .12s;
    }
    .notif-item:hover { border-color: var(--line); background: var(--panel); }
    .notif-item.unread {
      background: var(--blue-soft);
      border-color: rgba(43,15,134,.12);
    }

    /* Icône */
    .notif-ic {
      flex: none; width: 42px; height: 42px; border-radius: 13px;
      display: flex; align-items: center; justify-content: center;
      background: var(--panel); color: var(--blue);
    }
    .notif-ic.missed_call, .notif-ic.call_declined { color: var(--red); background: var(--red-soft); }
    .notif-ic.meeting_reminder { color: var(--orange); background: var(--orange-soft); }
    .notif-ic.incoming_call { color: var(--violet); background: #ede9fe; }

    /* Contenu */
    .notif-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .notif-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .notif-type-label { font-size: 11px; font-weight: 600; color: var(--faint); text-transform: uppercase; letter-spacing: .04em; }
    .notif-time { font-size: 11.5px; color: var(--faint); white-space: nowrap; }
    .notif-title { font-size: 14px; font-weight: 600; color: var(--ink); margin: 0; }
    .notif-desc { font-size: 13px; color: var(--muted); margin: 0; }

    /* Pastille non-lue */
    .unread-mark {
      flex: none; width: 8px; height: 8px; border-radius: 50%;
      background: var(--blue); margin-top: 4px;
    }

    .spin {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid var(--line); border-top-color: var(--blue);
      animation: spin .7s linear infinite; flex: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export class ActivityPage implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly live = inject(LiveUpdates);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);

  protected readonly items = signal<AppNotification[]>([]);
  protected readonly loading = signal(true);
  protected readonly unread = computed(() => this.items().filter((n) => !n.read).length);
  protected readonly rel = fmtRelative;
  protected icon = (t: NotificationType) => ICONS[t] ?? 'bell';
  protected typeLabel = (t: NotificationType) => TYPE_LABELS[t] ?? 'Notification';
  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit() {
    await this.load();
    this.timer = setInterval(() => this.load(), 20_000);
  }
  ngOnDestroy() { clearInterval(this.timer); }

  async load() {
    try {
      const r = await this.api.get<{ notifications: AppNotification[] }>('/api/notifications');
      this.items.set(r.notifications);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async open(n: AppNotification) {
    if (!n.read) {
      this.items.update((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      await this.api.post(`/api/notifications/${n.id}/read`).catch(() => {});
      this.live.refresh();
    }
    if (n.link) this.router.navigateByUrl(n.link);
  }

  async readAll() {
    await this.api.post('/api/notifications/read-all').catch(() => {});
    this.items.update((l) => l.map((x) => (x.type === 'incoming_call' ? x : { ...x, read: true })));
    this.live.refresh();
  }
}
