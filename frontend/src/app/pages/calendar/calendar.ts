import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { Meeting } from '../../core/models';
import { Toasts } from '../../core/toast';
import { CreateMeetingDialog } from '../home/create-meeting';

interface CalDay { date: Date; isCurrentMonth: boolean; isToday: boolean; meetings: Meeting[]; }

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS_FR   = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

@Component({
  selector: 'app-calendar-page',
  imports: [CreateMeetingDialog],
  template: `
    <div class="cal-page">

      <!-- En-tête -->
      <div class="cal-header">
        <div class="cal-header-left">
          <h1>Calendrier</h1>
          <p class="cal-sub">{{ monthLabel() }} {{ currentYear() }}</p>
        </div>
        <div class="cal-header-right">
          <div class="nav-btns">
            <button class="nav-btn" type="button" (click)="prevMonth()" aria-label="Mois précédent">
              <svg viewBox="0 0 20 20" fill="none"><path d="M12 5l-5 5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="today-btn" type="button" (click)="goToday()">Aujourd'hui</button>
            <button class="nav-btn" type="button" (click)="nextMonth()" aria-label="Mois suivant">
              <svg viewBox="0 0 20 20" fill="none"><path d="M8 5l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <button class="btn-new-meeting" type="button" (click)="creating.set(true)">
            <svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Nouvelle réunion
          </button>
        </div>
      </div>

      <!-- Grille calendrier -->
      <div class="cal-grid-wrap">
        <!-- Jours de la semaine -->
        <div class="day-labels">
          @for (d of dayLabels; track d) {
            <div class="day-label">{{ d }}</div>
          }
        </div>

        <!-- Cellules -->
        <div class="cal-grid">
          @for (day of calDays(); track day.date.toISOString()) {
            <div class="cal-cell"
              [class.other-month]="!day.isCurrentMonth"
              [class.today]="day.isToday"
              (click)="onDayClick(day)">
              <span class="day-num">{{ day.date.getDate() }}</span>
              <div class="cell-events">
                @for (m of day.meetings.slice(0, 3); track m.id) {
                  <button class="event-chip"
                    [class.live]="m.status === 'live'"
                    [class.ended]="m.status === 'ended'"
                    type="button"
                    (click)="$event.stopPropagation(); openMeeting(m)"
                    [title]="m.title">
                    @if (m.status === 'live') { <span class="live-dot"></span> }
                    <span class="event-title">{{ m.title }}</span>
                    @if (m.scheduledStart) {
                      <span class="event-time">{{ fmtTime(m.scheduledStart) }}</span>
                    }
                  </button>
                }
                @if (day.meetings.length > 3) {
                  <span class="more-chip">+{{ day.meetings.length - 3 }}</span>
                }
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Panel latéral : détail jour sélectionné -->
      @if (selectedDay()) {
        <div class="side-panel">
          <div class="side-head">
            <div>
              <p class="side-date-label">{{ fmtDayLong(selectedDay()!.date) }}</p>
              <span class="side-count">{{ selectedDay()!.meetings.length }} réunion{{ selectedDay()!.meetings.length > 1 ? 's' : '' }}</span>
            </div>
            <button class="close-side" type="button" (click)="selectedDay.set(null)" aria-label="Fermer">
              <svg viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>

          @if (!selectedDay()!.meetings.length) {
            <div class="side-empty">
              <svg viewBox="0 0 48 48" fill="none"><rect x="8" y="10" width="32" height="30" rx="5" stroke="currentColor" stroke-width="1.5"/><path d="M8 18h32M16 6v6M32 6v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              <p>Aucune réunion ce jour</p>
              <button class="btn-add-day" type="button" (click)="creating.set(true)">+ Planifier une réunion</button>
            </div>
          } @else {
            <div class="side-list">
              @for (m of selectedDay()!.meetings; track m.id) {
                <div class="side-card" [class.live]="m.status === 'live'" [class.ended]="m.status === 'ended'">
                  <div class="side-card-top">
                    <span class="status-dot-lg" [class.live]="m.status === 'live'" [class.ended]="m.status === 'ended'"></span>
                    <div class="side-card-info">
                      <h3>{{ m.title }}</h3>
                      <p class="side-meta">
                        @if (m.scheduledStart) { {{ fmtTime(m.scheduledStart) }} }
                        @if (m.scheduledEnd) { – {{ fmtTime(m.scheduledEnd) }} }
                        @if (m.organizerName) { · {{ m.organizerName }} }
                      </p>
                    </div>
                    <span class="status-badge" [class.live]="m.status === 'live'" [class.ended]="m.status === 'ended'">
                      {{ m.status === 'live' ? '🔴 En cours' : m.status === 'ended' ? 'Terminée' : 'Planifiée' }}
                    </span>
                  </div>
                  @if (m.description) {
                    <p class="side-desc">{{ m.description }}</p>
                  }
                  <div class="side-card-foot">
                    <span class="mono side-code">{{ m.code }}</span>
                    <button class="btn-join" type="button" (click)="openMeeting(m)" [disabled]="m.status === 'ended'">
                      {{ m.status === 'live' ? 'Rejoindre' : m.status === 'ended' ? 'Terminée' : 'Ouvrir' }}
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

    </div>

    @if (creating()) {
      <app-create-meeting (closed)="creating.set(false)" (created)="onCreated($event)" />
    }
  `,
  styles: `
    :host { display: block; }

    /* ---- Page layout ----------------------------------------------- */
    .cal-page { display: flex; flex-direction: column; gap: 20px; position: relative; }

    /* ---- Header ---------------------------------------------------- */
    .cal-header {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 12px;
    }
    h1 { font-size: 22px; font-weight: 700; color: #16131F; margin: 0; letter-spacing: -.02em; }
    .cal-sub { font-size: 13px; color: #8E889E; margin: 2px 0 0; }
    .cal-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

    .nav-btns { display: flex; align-items: center; gap: 4px; }
    .nav-btn {
      width: 36px; height: 36px; border-radius: 10px; border: 1.5px solid #E8EAF0;
      background: #fff; color: #625D72; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .12s, border-color .12s;
    }
    .nav-btn:hover { background: #F0F2F8; border-color: #D1D5E8; }
    .nav-btn svg { width: 16px; height: 16px; }
    .today-btn {
      height: 36px; padding: 0 14px; border-radius: 10px;
      border: 1.5px solid #E8EAF0; background: #fff; color: #2B0F86;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: background .12s;
    }
    .today-btn:hover { background: #EBF0FF; }

    .btn-new-meeting {
      display: inline-flex; align-items: center; gap: 8px;
      height: 40px; padding: 0 18px; border-radius: 12px; border: none;
      background: #2B0F86; color: #fff;
      font-size: 13.5px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 14px rgba(43,15,134,.25);
      transition: background .12s;
    }
    .btn-new-meeting:hover { background: #1a0657; }
    .btn-new-meeting svg { width: 16px; height: 16px; }

    /* ---- Grille ---------------------------------------------------- */
    .cal-grid-wrap {
      background: #fff; border-radius: 20px;
      border: 1px solid #E8EAF0;
      box-shadow: 0 2px 12px rgba(43,15,134,.04);
      overflow: hidden;
    }

    .day-labels {
      display: grid; grid-template-columns: repeat(7, 1fr);
      border-bottom: 1px solid #F0F2F8;
    }
    .day-label {
      padding: 10px 0; text-align: center;
      font-size: 12px; font-weight: 600; color: #8E889E;
      text-transform: uppercase; letter-spacing: .05em;
    }

    .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }

    .cal-cell {
      min-height: 110px; padding: 10px 8px;
      border-right: 1px solid #F0F2F8; border-bottom: 1px solid #F0F2F8;
      cursor: pointer; transition: background .1s;
      display: flex; flex-direction: column; gap: 4px;
    }
    .cal-cell:hover { background: #FAFBFF; }
    .cal-cell:nth-child(7n) { border-right: none; }

    .cal-cell.other-month { background: #FAFBFD; }
    .cal-cell.other-month .day-num { color: #C8C5D4; }
    .cal-cell.today .day-num {
      background: #2B0F86; color: #fff;
      border-radius: 50%; width: 26px; height: 26px;
      display: flex; align-items: center; justify-content: center;
    }

    .day-num {
      font-size: 13px; font-weight: 600; color: #16131F;
      width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    }

    .cell-events { display: flex; flex-direction: column; gap: 3px; }

    .event-chip {
      display: flex; align-items: center; gap: 5px;
      padding: 3px 7px; border-radius: 6px; border: none;
      background: #EBF0FF; color: #2B0F86;
      font-size: 11px; font-weight: 500; cursor: pointer;
      text-align: left; width: 100%; overflow: hidden;
      transition: background .1s;
    }
    .event-chip:hover { background: #D6E4FF; }
    .event-chip.live { background: #DCFCE7; color: #166534; }
    .event-chip.ended { background: #F3F4F6; color: #6B7280; }

    .live-dot {
      width: 6px; height: 6px; border-radius: 50%; background: #22C55E; flex: none;
      animation: pulse 1.4s ease infinite;
    }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }

    .event-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-time { font-size: 10px; opacity: .7; white-space: nowrap; flex: none; }
    .more-chip {
      font-size: 11px; color: #8E889E; font-weight: 600;
      padding: 2px 7px;
    }

    /* ---- Panel latéral -------------------------------------------- */
    .side-panel {
      position: fixed; right: 0; top: 0; bottom: 0;
      width: 360px; background: #fff;
      border-left: 1px solid #E8EAF0;
      box-shadow: -8px 0 32px rgba(0,0,0,.08);
      z-index: 30;
      display: flex; flex-direction: column;
      overflow-y: auto;
    }

    .side-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      padding: 24px 20px 16px; border-bottom: 1px solid #F0F2F8;
    }
    .side-date-label { font-size: 15px; font-weight: 700; color: #16131F; margin: 0; text-transform: capitalize; }
    .side-count { font-size: 12px; color: #8E889E; margin: 2px 0 0; display: block; }
    .close-side {
      width: 32px; height: 32px; border-radius: 9px; border: none;
      background: #F0F2F8; color: #625D72; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .1s;
    }
    .close-side:hover { background: #E8EAF0; }
    .close-side svg { width: 15px; height: 15px; }

    .side-empty {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: 48px 20px; text-align: center;
    }
    .side-empty svg { width: 48px; height: 48px; color: #D1D5E8; }
    .side-empty p { font-size: 14px; font-weight: 600; color: #625D72; margin: 0; }
    .btn-add-day {
      height: 38px; padding: 0 16px; border-radius: 10px; border: none;
      background: #2B0F86; color: #fff; font-size: 13px; font-weight: 600;
      cursor: pointer;
    }

    .side-list { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }

    .side-card {
      background: #F8F9FC; border-radius: 16px; padding: 14px;
      border: 1.5px solid #E8EAF0;
      display: flex; flex-direction: column; gap: 10px;
      transition: border-color .12s;
    }
    .side-card:hover { border-color: #2B0F86; }
    .side-card.live { background: #F0FDF4; border-color: #BBF7D0; }
    .side-card.ended { background: #F9FAFB; border-color: #E5E7EB; }

    .side-card-top { display: flex; align-items: flex-start; gap: 10px; }
    .status-dot-lg {
      width: 10px; height: 10px; border-radius: 50%; flex: none; margin-top: 4px;
      background: #2B0F86;
    }
    .status-dot-lg.live { background: #22C55E; animation: pulse 1.4s ease infinite; }
    .status-dot-lg.ended { background: #D1D5DB; }

    .side-card-info { flex: 1; min-width: 0; }
    .side-card-info h3 { font-size: 14px; font-weight: 700; color: #16131F; margin: 0; }
    .side-meta { font-size: 12px; color: #8E889E; margin: 2px 0 0; }

    .status-badge {
      flex: none; font-size: 11px; font-weight: 600;
      padding: 3px 8px; border-radius: 999px;
      background: #EBF0FF; color: #2B0F86; white-space: nowrap;
    }
    .status-badge.live { background: #DCFCE7; color: #166534; }
    .status-badge.ended { background: #F3F4F6; color: #6B7280; }

    .side-desc { font-size: 12.5px; color: #625D72; margin: 0; line-height: 1.5; }
    .side-code { font-size: 11.5px; color: #8E889E; }

    .side-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .btn-join {
      height: 34px; padding: 0 14px; border-radius: 10px; border: none;
      background: #2B0F86; color: #fff; font-size: 12.5px; font-weight: 600;
      cursor: pointer; transition: background .12s;
    }
    .btn-join:hover:not(:disabled) { background: #1a0657; }
    .btn-join:disabled { opacity: .4; cursor: not-allowed; }

    @media (max-width: 768px) {
      .cal-cell { min-height: 70px; }
      .event-time { display: none; }
      .side-panel { width: 100%; top: auto; border-left: none; border-top: 1px solid #E8EAF0; height: 60vh; }
    }
  `,
})
export class CalendarPage implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly auth = inject(Auth);

  protected readonly creating = signal(false);
  protected readonly selectedDay = signal<CalDay | null>(null);

  private readonly viewDate = signal(new Date());
  private allMeetings = signal<Meeting[]>([]);
  private timer?: ReturnType<typeof setInterval>;

  protected readonly dayLabels = DAYS_FR;
  protected readonly monthLabel = computed(() => MONTHS_FR[this.viewDate().getMonth()]);
  protected readonly currentYear = computed(() => this.viewDate().getFullYear());

  protected readonly calDays = computed((): CalDay[] => {
    const d = this.viewDate();
    const year = d.getFullYear();
    const month = d.getMonth();
    const today = new Date(); today.setHours(0,0,0,0);

    const firstDay = new Date(year, month, 1);
    // Lundi = 0
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const days: CalDay[] = [];
    for (let i = -startOffset; i < 42 - startOffset; i++) {
      const date = new Date(year, month, 1 + i);
      date.setHours(0,0,0,0);
      const isCurrentMonth = date.getMonth() === month;
      const isToday = date.getTime() === today.getTime();
      const meetings = this.allMeetings().filter(m => {
        const ref = m.scheduledStart || m.startedAt;
        if (!ref) return false;
        const md = new Date(ref); md.setHours(0,0,0,0);
        return md.getTime() === date.getTime();
      });
      days.push({ date, isCurrentMonth, isToday, meetings });
    }
    return days;
  });

  async ngOnInit() {
    await this.load();
    this.timer = setInterval(() => this.load(), 60_000);
  }
  ngOnDestroy() { clearInterval(this.timer); }

  async load() {
    try {
      const r = await this.api.get<{ upcoming: Meeting[]; rooms: Meeting[] }>('/api/meetings');
      this.allMeetings.set(r.upcoming);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  prevMonth() {
    const d = new Date(this.viewDate());
    d.setMonth(d.getMonth() - 1);
    this.viewDate.set(d);
    this.selectedDay.set(null);
  }

  nextMonth() {
    const d = new Date(this.viewDate());
    d.setMonth(d.getMonth() + 1);
    this.viewDate.set(d);
    this.selectedDay.set(null);
  }

  goToday() {
    this.viewDate.set(new Date());
    this.selectedDay.set(null);
  }

  onDayClick(day: CalDay) {
    this.selectedDay.set(day);
  }

  openMeeting(m: Meeting) {
    this.router.navigate(['/reunion', m.code]);
  }

  onCreated(m: Meeting) {
    this.creating.set(false);
    this.load();
    if (!m.scheduledStart || new Date(m.scheduledStart).getTime() - Date.now() < 10 * 60_000) {
      this.router.navigate(['/reunion', m.code]);
    } else {
      this.toasts.show(`Réunion « ${m.title} » planifiée !`);
    }
  }

  protected fmtTime(iso: string) {
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  protected fmtDayLong(d: Date) {
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  }
}
