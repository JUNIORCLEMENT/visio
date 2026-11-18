import { Component, Injectable, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Avatar } from '../shared/avatar';
import { Icon } from '../shared/icon';
import { Api, errorMessage } from './api';
import { Auth } from './auth';
import { IncomingCall } from './models';
import { Toasts } from './toast';

/**
 * Mises à jour en continu pour la personne connectée :
 * nombre de notifications non lues (Activité), appel entrant, présence « en ligne ».
 */
@Injectable({ providedIn: 'root' })
export class LiveUpdates {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);

  readonly unread = signal(0);
  readonly incomingCall = signal<IncomingCall | null>(null);
  /** Appels refusés par l'utilisateur sur cet onglet (pour ne pas re-sonner pendant la requête). */
  private readonly dismissed = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    effect(() => {
      if (this.auth.user()) this.start();
      else this.stop();
    });
  }

  private start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 4000);
  }

  private stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.unread.set(0);
    this.incomingCall.set(null);
  }

  async refresh() {
    try {
      const s = await this.api.get<{ unread: number; incomingCall: IncomingCall | null }>('/api/notifications/summary');
      this.unread.set(s.unread);
      const call = s.incomingCall && !this.dismissed.has(s.incomingCall.code) ? s.incomingCall : null;
      this.incomingCall.set(call);
    } catch {
      /* hors ligne ou session expirée : nouvel essai au prochain passage */
    }
  }

  dismiss(code: string) {
    this.dismissed.add(code);
    this.incomingCall.set(null);
  }
}

/** Fenêtre « X vous appelle » avec sonnerie, visible sur toutes les pages. */
@Component({
  selector: 'app-incoming-call',
  imports: [Avatar, Icon],
  template: `
    @if (live.incomingCall(); as call) {
      <div class="ring" role="alertdialog" aria-modal="false" aria-labelledby="ring-title">
        <div class="pulse"><app-avatar [name]="call.callerName" size="l" /></div>
        <div class="txt">
          <b id="ring-title">{{ call.callerName }}</b>
          <span>vous appelle sur HPO Visio@if (call.callerDepartment) { · {{ call.callerDepartment }} }</span>
          <span class="rec">Cet appel sera enregistré et conservé par la DSID.</span>
        </div>
        <div class="acts">
          <button class="round decline" type="button" (click)="decline(call.code)" aria-label="Refuser l’appel"><app-icon name="hangup" /></button>
          <button class="round accept" type="button" (click)="accept(call.code)" aria-label="Répondre"><app-icon name="cam" /></button>
        </div>
      </div>
    }
  `,
  styles: `
    .ring { position: fixed; top: 20px; right: 20px; z-index: 90; width: min(380px, calc(100% - 40px)); background: var(--brand); color: #fff;
      border-radius: 24px; padding: 20px; box-shadow: 0 24px 60px rgba(16, 4, 60, .45); display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
    .pulse { border-radius: 50%; animation: pulse 1.4s ease-out infinite; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.5); } 100% { box-shadow: 0 0 0 22px rgba(255,255,255,0); } }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
    .txt { display: flex; flex-direction: column; gap: 4px; }
    .txt b { font-size: 18px; }
    .txt span { font-size: 13px; opacity: .85; }
    .txt .rec { font-size: 11px; opacity: .7; }
    .acts { display: flex; gap: 28px; }
    .round { width: 56px; height: 56px; border-radius: 50%; border: none; color: #fff; display: flex; align-items: center; justify-content: center; }
    .decline { background: var(--red); }
    .accept { background: #7C63F0; }
  `,
})
export class IncomingCallAlert {
  protected readonly live = inject(LiveUpdates);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private ctx?: AudioContext;
  private ringTimer?: ReturnType<typeof setInterval>;

  constructor() {
    effect(() => {
      if (this.live.incomingCall()) this.startRing();
      else this.stopRing();
    });
  }

  accept(code: string) {
    this.live.dismiss(code);
    this.router.navigate(['/reunion', code]);
  }

  async decline(code: string) {
    this.live.dismiss(code);
    try {
      await this.api.post(`/api/calls/${code}/decline`);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  /** Sonnerie générée (deux tons), sans fichier audio. */
  private startRing() {
    if (this.ringTimer) return;
    const ring = () => {
      try {
        this.ctx ??= new AudioContext();
        const t = this.ctx.currentTime;
        for (const [i, f] of [[0, 660], [0.25, 880], [0.6, 660], [0.85, 880]] as const) {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t + i);
          g.gain.exponentialRampToValueAtTime(0.12, t + i + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + i + 0.22);
          o.connect(g).connect(this.ctx.destination);
          o.start(t + i);
          o.stop(t + i + 0.24);
        }
      } catch {
        /* son indisponible */
      }
    };
    ring();
    this.ringTimer = setInterval(ring, 2500);
  }

  private stopRing() {
    clearInterval(this.ringTimer);
    this.ringTimer = undefined;
  }
}
