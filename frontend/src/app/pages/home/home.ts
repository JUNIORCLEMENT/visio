import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { fmtDay, fmtTime, normalizeMeetingCode } from '../../core/labels';
import { Meeting } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';
import { CreateMeetingDialog } from './create-meeting';

@Component({
  selector: 'app-home-page',
  imports: [FormsModule, Icon, CreateMeetingDialog],
  template: `
    <!-- Header style Google Duo -->
    <div class="page-header">
      <div class="header-left">
        <h1>Accueil</h1>
        <p class="header-sub">{{ today }}</p>
      </div>
      <div class="header-right">
        @if (auth.canOrganize()) {
          <button class="btn-primary" type="button" (click)="creating.set(true)">
            <svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
            Nouvelle réunion
          </button>
        }
        <form class="join-form" (ngSubmit)="joinByCode()" novalidate>
          <div class="join-wrap">
            <svg viewBox="0 0 20 20" fill="none" class="join-ico">
              <path d="M17.5 17.5l-3.5-3.5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <input class="join-input" [(ngModel)]="code" name="code"
              placeholder="Code de réunion…" autocomplete="off" />
          </div>
          <button class="btn-secondary" type="submit">Rejoindre</button>
        </form>
      </div>
    </div>
    @if (codeError()) { <p class="code-err" role="alert">{{ codeError() }}</p> }

    <!-- Badges de stats style Google Duo -->
    <div class="stats-row">
      <div class="stat-chip blue">
        <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 8h14" stroke="currentColor" stroke-width="1.5"/><path d="M7 2v3M13 2v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        {{ upcoming().length }} réunion{{ upcoming().length > 1 ? 's' : '' }} planifiée{{ upcoming().length > 1 ? 's' : '' }}
      </div>
      <div class="stat-chip green">
        <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        {{ liveCount() }} en cours
      </div>
      <div class="stat-chip purple">
        <svg viewBox="0 0 20 20" fill="none"><path d="M3 10a7 7 0 1 1 14 0A7 7 0 0 1 3 10Z" stroke="currentColor" stroke-width="1.5"/><path d="M10 7v3l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        {{ rooms().length }} salle{{ rooms().length > 1 ? 's' : '' }} permanente{{ rooms().length > 1 ? 's' : '' }}
      </div>
      <div class="stat-chip orange">
        <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 17c0-3.038 2.91-5.5 6.5-5.5s6.5 2.462 6.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Bonjour, {{ firstName() }}
      </div>
    </div>

    <!-- Grille principale -->
    <div class="main-grid">

      <!-- Mes réunions -->
      <div class="card">
        <div class="card-head">
          <h2>Mes réunions</h2>
          <span class="chip-count">{{ upcoming().length }}</span>
        </div>

        @if (loading()) {
          <div class="loading"><span class="spin"></span> Chargement…</div>
        } @else if (!upcoming().length) {
          <div class="empty">
            <svg viewBox="0 0 56 56" fill="none"><rect x="8" y="10" width="40" height="38" rx="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 22h40M20 6v8M36 6v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M20 32h16M20 38h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <p>Aucune réunion prévue</p>
            @if (auth.canOrganize()) { <span>Créez-en une avec le bouton « Nouvelle réunion »</span> }
          </div>
        } @else {
          @for (m of upcoming(); track m.id) {
            <div class="meet-row">
              <div class="meet-time-box">
                @if (m.scheduledStart) {
                  <b>{{ time(m.scheduledStart) }}</b>
                  <span>{{ day(m.scheduledStart) }}</span>
                } @else {
                  <b>—</b><span>Maintenant</span>
                }
              </div>
              <div class="meet-body">
                <div class="meet-name-row">
                  <span class="meet-name">{{ m.title }}</span>
                  @if (m.participants > 0) {
                    <span class="live-tag">
                      <span class="live-dot"></span>
                      {{ m.participants }}
                    </span>
                  }
                </div>
                <span class="meet-code mono">{{ m.code }}</span>
              </div>
              <div class="meet-actions">
                @if (m.isHost && m.allowGuests) {
                  <button class="icon-btn" type="button" (click)="copyGuestLink(m)" title="Copier le lien invité">
                    <app-icon name="link" [size]="15"/>
                  </button>
                }
                <button class="btn-join" type="button" (click)="open(m.code)">
                  {{ m.isHost && !m.participants ? 'Démarrer' : 'Rejoindre' }}
                </button>
              </div>
            </div>
          }
        }
      </div>

      <!-- Salles permanentes -->
      <div class="card">
        <div class="card-head">
          <h2>Salles permanentes</h2>
          <span class="chip-count">{{ rooms().length }}</span>
        </div>

        @if (!loading() && !rooms().length) {
          <div class="empty">
            <svg viewBox="0 0 56 56" fill="none"><path d="M8 48V18l20-10 20 10v30H8Z" stroke="currentColor" stroke-width="1.5"/><rect x="20" y="32" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M28 24v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <p>Aucune salle permanente</p>
            <span>Un administrateur peut en créer depuis Admin</span>
          </div>
        }

        @for (r of rooms(); track r.id) {
          <div class="meet-row">
            <div class="room-ic">
              <app-icon name="door" [size]="18"/>
            </div>
            <div class="meet-body">
              <div class="meet-name-row">
                <span class="meet-name">{{ r.title }}</span>
                @if (r.participants > 0) {
                  <span class="live-tag"><span class="live-dot"></span>{{ r.participants }}</span>
                }
              </div>
              <span class="meet-code">{{ r.department ?? 'Tous services' }} · <span class="mono">{{ r.code }}</span></span>
            </div>
            <div class="meet-actions">
              <button class="btn-outline" type="button" (click)="open(r.code)">Entrer</button>
            </div>
          </div>
        }
      </div>
    </div>

    @if (creating()) {
      <app-create-meeting (closed)="creating.set(false)" (created)="onCreated($event)" />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 20px; }

    /* ---- Header --------------------------------------------------- */
    .page-header {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap;
    }
    h1 { font-size: 22px; font-weight: 700; color: #16131F; margin: 0; letter-spacing: -.02em; }
    .header-sub { font-size: 13px; color: #8E889E; margin: 2px 0 0; text-transform: capitalize; }
    .header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

    .btn-primary {
      display: inline-flex; align-items: center; gap: 8px;
      height: 42px; padding: 0 18px;
      border-radius: 12px; border: none;
      background: #2B0F86; color: #fff;
      font-size: 13.5px; font-weight: 600;
      cursor: pointer; white-space: nowrap;
      transition: background .12s, box-shadow .12s;
      box-shadow: 0 4px 14px rgba(43,15,134,.25);
    }
    .btn-primary:hover { background: #1a0657; }
    .btn-primary svg { width: 16px; height: 16px; }

    .join-form { display: flex; gap: 0; }
    .join-wrap { position: relative; display: flex; align-items: center; }
    .join-ico {
      position: absolute; left: 11px;
      width: 15px; height: 15px; color: #8E889E; pointer-events: none;
    }
    .join-input {
      height: 42px; padding: 0 12px 0 32px;
      border-radius: 12px 0 0 12px;
      border: 1.5px solid #E8EAF0; border-right: none;
      background: #fff; color: #16131F;
      font-size: 13px; outline: none; width: 200px;
      transition: border-color .12s;
    }
    .join-input:focus { border-color: #2B0F86; }
    .join-input::placeholder { color: #B0ABBF; }
    .btn-secondary {
      height: 42px; padding: 0 16px;
      border-radius: 0 12px 12px 0;
      border: 1.5px solid #E8EAF0;
      background: #fff; color: #2B0F86;
      font-size: 13px; font-weight: 600;
      cursor: pointer;
      transition: background .12s, border-color .12s;
    }
    .btn-secondary:hover { background: #EBF0FF; border-color: #2B0F86; }
    .code-err { font-size: 12px; color: #E5323B; margin: -8px 0 0; }

    /* ---- Stats chips style Google Duo ----------------------------- */
    .stats-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .stat-chip {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 7px 14px; border-radius: 999px;
      font-size: 13px; font-weight: 600;
      white-space: nowrap;
    }
    .stat-chip svg { width: 15px; height: 15px; flex: none; }
    .stat-chip.blue   { background: #EBF0FF; color: #2B0F86; }
    .stat-chip.green  { background: #ECFDF5; color: #065F46; }
    .stat-chip.purple { background: #F3EEFF; color: #5B21B6; }
    .stat-chip.orange { background: #FFF7ED; color: #9A3412; }

    /* ---- Grille principale ---------------------------------------- */
    .main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

    .card {
      background: #fff;
      border-radius: 20px;
      border: 1px solid #E8EAF0;
      padding: 20px 22px;
      display: flex; flex-direction: column; gap: 4px;
      box-shadow: 0 2px 12px rgba(43,15,134,.04);
    }
    .card-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px;
    }
    h2 { font-size: 15px; font-weight: 700; color: #16131F; margin: 0; }
    .chip-count {
      min-width: 24px; height: 24px; padding: 0 7px;
      border-radius: 999px;
      background: #EBF0FF; color: #2B0F86;
      font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
    }

    /* ---- Loading / Empty ------------------------------------------ */
    .loading { display: flex; align-items: center; gap: 10px; color: #8E889E; font-size: 13px; padding: 20px 0; }
    .empty {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 32px 16px; text-align: center;
    }
    .empty svg { width: 48px; height: 48px; color: #D1D5E8; }
    .empty p { font-size: 14px; font-weight: 600; color: #625D72; margin: 0; }
    .empty span { font-size: 12px; color: #8E889E; }

    /* ---- Lignes de réunion ---------------------------------------- */
    .meet-row {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 12px;
      border-radius: 14px;
      transition: background .12s;
      cursor: default;
    }
    .meet-row:hover { background: #F8F9FC; }

    .meet-time-box {
      flex: none; width: 52px; text-align: center;
      display: flex; flex-direction: column; gap: 1px;
    }
    .meet-time-box b { font-size: 14px; font-weight: 700; color: #16131F; }
    .meet-time-box span { font-size: 10px; color: #8E889E; text-transform: capitalize; }

    .room-ic {
      flex: none; width: 38px; height: 38px;
      border-radius: 12px;
      background: #EBF0FF; color: #2B0F86;
      display: flex; align-items: center; justify-content: center;
    }

    .meet-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .meet-name-row { display: flex; align-items: center; gap: 8px; }
    .meet-name {
      font-size: 13.5px; font-weight: 600; color: #16131F;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .meet-code { font-size: 11.5px; color: #8E889E; }

    .live-tag {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 8px; border-radius: 999px;
      background: #2B0F86; color: #fff;
      font-size: 11px; font-weight: 600; flex: none;
    }
    .live-dot {
      width: 5px; height: 5px; border-radius: 50%; background: #fff;
      animation: pulse 1.4s ease infinite;
    }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }

    .meet-actions { flex: none; display: flex; align-items: center; gap: 6px; }
    .icon-btn {
      width: 32px; height: 32px; border-radius: 9px;
      border: 1.5px solid #E8EAF0; background: #fff;
      color: #625D72; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: color .12s, border-color .12s;
    }
    .icon-btn:hover { color: #2B0F86; border-color: #2B0F86; }

    .btn-join {
      height: 34px; padding: 0 14px;
      border-radius: 10px; border: none;
      background: #2B0F86; color: #fff;
      font-size: 12.5px; font-weight: 600;
      cursor: pointer;
      transition: background .12s;
    }
    .btn-join:hover { background: #1a0657; }

    .btn-outline {
      height: 34px; padding: 0 14px;
      border-radius: 10px;
      border: 1.5px solid #E8EAF0; background: #fff;
      color: #2B0F86; font-size: 12.5px; font-weight: 600;
      cursor: pointer;
      transition: background .12s, border-color .12s;
    }
    .btn-outline:hover { background: #EBF0FF; border-color: #2B0F86; }

    .spin {
      width: 15px; height: 15px; border-radius: 50%;
      border: 2px solid #E8EAF0; border-top-color: #2B0F86;
      animation: spin .7s linear infinite; flex: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 900px) { .main-grid { grid-template-columns: 1fr; } }
    @media (max-width: 640px) {
      .header-right { width: 100%; }
      .join-input { width: 140px; }
    }
  `,
})
export class HomePage implements OnInit, OnDestroy {
  protected readonly auth = inject(Auth);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);

  protected readonly upcoming = signal<Meeting[]>([]);
  protected readonly rooms = signal<Meeting[]>([]);
  protected readonly loading = signal(true);
  protected readonly creating = signal(false);
  protected readonly codeError = signal('');
  protected readonly firstName = computed(() => (this.auth.user()?.fullName ?? '').split(' ')[0]);
  protected readonly liveCount = computed(() => this.upcoming().filter(m => m.participants > 0).length);
  protected readonly today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date()).replace(/^./, c => c.toUpperCase());
  protected code = '';
  private timer?: ReturnType<typeof setInterval>;
  protected readonly time = fmtTime;
  protected readonly day = fmtDay;

  async ngOnInit() {
    await this.load();
    this.timer = setInterval(() => this.load(), 30_000);
  }
  ngOnDestroy() { clearInterval(this.timer); }

  async load() {
    try {
      const r = await this.api.get<{ upcoming: Meeting[]; rooms: Meeting[] }>('/api/meetings');
      this.upcoming.set(r.upcoming);
      this.rooms.set(r.rooms);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  joinByCode() {
    const c = normalizeMeetingCode(this.code);
    if (!c) { this.codeError.set('Le code contient 6 chiffres, ex. hpo-482-913.'); return; }
    this.codeError.set('');
    this.open(c);
  }

  open(code: string) { this.router.navigate(['/reunion', code]); }

  async copyGuestLink(m: Meeting) {
    const link = `${location.origin}/rejoindre/${m.code}`;
    try {
      await navigator.clipboard.writeText(link);
      this.toasts.show('Lien invité copié : ' + link);
    } catch {
      this.toasts.show('Lien invité : ' + link, 'info', 8000);
    }
  }

  onCreated(m: Meeting) {
    this.creating.set(false);
    this.load();
    if (!m.scheduledStart || new Date(m.scheduledStart).getTime() - Date.now() < 10 * 60_000) {
      this.open(m.code);
    } else {
      this.toasts.show(`Réunion « ${m.title} » créée. Code : ${m.code}`);
    }
  }
}
