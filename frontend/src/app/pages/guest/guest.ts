import { Component, OnDestroy, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { LiveKitAccess } from '../../core/models';
import { AuthLayout } from '../../shared/auth-layout';
import { Prejoin } from '../../room/prejoin';
import { RoomView } from '../../room/room';
import { EndReason, JoinOptions, RoomSession } from '../../room/room-session';

interface PublicMeeting {
  code: string;
  title: string;
  organizerName: string | null;
  status: 'scheduled' | 'live' | 'ended';
  guestsAllowed: boolean;
  waitingRoom: boolean;
  recording: boolean;
}

interface GuestStatus {
  status: 'waiting' | 'admitted' | 'denied';
  guestToken?: string;
  livekit?: LiveKitAccess;
}

type Phase = 'loading' | 'closed' | 'form' | 'waiting' | 'denied' | 'prejoin' | 'room' | 'ended';

/** Invité externe : nom → salle d'attente → admission → réunion. */
@Component({
  selector: 'app-guest-page',
  imports: [FormsModule, RouterLink, AuthLayout, Prejoin, RoomView],
  template: `
    @switch (phase()) {
      @case ('room') {
        @if (session(); as s) {
          <app-room [session]="s" [code]="code()" [title]="meeting()?.title ?? ''" [selfId]="'g:' + requestId"
            [authHeaders]="headers()" [recording]="!!meeting()?.recording" (ended)="onEnded($event)" />
        }
      }
      @case ('prejoin') {
        <div class="wrap"><div class="card">
          <app-prejoin [subtitle]="meeting()?.title ?? ''" [busy]="joining()" (joined)="join($event)"
            [notice]="meeting()?.recording ? 'Cette réunion est enregistrée. En la rejoignant, vous acceptez cet enregistrement.' : ''">
            @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
          </app-prejoin>
        </div></div>
      }
      @default {
        <app-auth-layout tagline="Vous êtes invité à une réunion HPO Visio.">
          <div class="stack box" aria-live="polite">
            @switch (phase()) {
              @case ('loading') { <span class="spin"></span> }
              @case ('closed') {
                <h1>Accès impossible</h1>
                <p class="sub">{{ error() }}</p>
                <p class="hint">Vous avez un compte HPO ? <a [routerLink]="['/reunion', code()]">Rejoindre avec votre compte</a></p>
              }
              @case ('form') {
                <div>
                  <span class="pill">Invité externe</span>
                  <h1 class="t">{{ meeting()?.title }}</h1>
                  @if (meeting()?.organizerName) { <p class="sub">Organisée par {{ meeting()?.organizerName }}</p> }
                </div>
                <form class="stack" (ngSubmit)="request()" novalidate>
                  <div class="field">
                    <label for="g-name">Votre nom complet</label>
                    <input id="g-name" name="name" [(ngModel)]="name" maxlength="80" autocomplete="name" required autofocus />
                  </div>
                  <div class="field">
                    <label for="g-org">Organisation (facultatif)</label>
                    <input id="g-org" name="org" [(ngModel)]="organization" maxlength="120" autocomplete="organization" />
                  </div>
                  @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
                  <button class="btn primary wide" type="submit" [disabled]="busy()">
                    {{ meeting()?.waitingRoom ? 'Demander à rejoindre' : 'Continuer' }}
                  </button>
                  @if (meeting()?.waitingRoom) { <p class="hint">L’organisateur vous fera entrer depuis la salle d’attente.</p> }
                  @if (meeting()?.recording) { <p class="hint">Cette réunion est enregistrée par HPO &amp; Associés.</p> }
                </form>
                <p class="hint">Vous avez un compte HPO ? <a [routerLink]="['/reunion', code()]">Se connecter</a></p>
              }
              @case ('waiting') {
                <h1>Salle d’attente</h1>
                <div class="row"><span class="spin" aria-hidden="true"></span><span class="sub">L’organisateur a été prévenu. Vous entrerez dès qu’il vous aura admis.</span></div>
                <p class="hint">Gardez cette page ouverte.</p>
              }
              @case ('denied') {
                <h1>Accès refusé</h1>
                <p class="sub">L’organisateur n’a pas accepté votre demande, ou la réunion est terminée.</p>
              }
              @case ('ended') {
                <h1>{{ endText() }}</h1>
                <p class="sub">Merci d’avoir participé. Vous pouvez fermer cette page.</p>
              }
            }
          </div>
        </app-auth-layout>
      }
    }
  `,
  styles: `
    .box { max-width: 440px; width: 100%; }
    .t { margin-top: 10px; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px; min-height: 100vh; display: flex; align-items: center; }
    .wrap .card { width: 100%; }
  `,
})
export class GuestPage implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  readonly code = input.required<string>();

  protected readonly phase = signal<Phase>('loading');
  protected readonly meeting = signal<PublicMeeting | null>(null);
  protected readonly session = signal<RoomSession | null>(null);
  protected readonly headers = signal<Record<string, string>>({});
  protected readonly busy = signal(false);
  protected readonly joining = signal(false);
  protected readonly error = signal('');
  protected readonly endReason = signal<EndReason>('left');
  protected name = '';
  protected organization = '';
  protected requestId = '';
  private secret = '';
  private access?: LiveKitAccess;
  private poll?: ReturnType<typeof setInterval>;

  async ngOnInit() {
    try {
      const m = await this.api.get<PublicMeeting>(`/api/public/meetings/${encodeURIComponent(this.code())}`);
      this.meeting.set(m);
      if (!m.guestsAllowed) {
        this.error.set('Les invités externes ne sont pas autorisés dans cette réunion.');
        this.phase.set('closed');
      } else if (m.status === 'ended') {
        this.error.set('Cette réunion est terminée.');
        this.phase.set('closed');
      } else {
        this.phase.set('form');
      }
    } catch (e) {
      this.error.set(errorMessage(e));
      this.phase.set('closed');
    }
  }

  ngOnDestroy() {
    clearInterval(this.poll);
  }

  async request() {
    this.error.set('');
    if (this.name.trim().length < 2) {
      this.error.set('Indiquez votre nom complet.');
      return;
    }
    this.busy.set(true);
    try {
      const r = await this.api.post<{ requestId: string; secret: string; status: string }>(
        `/api/public/meetings/${encodeURIComponent(this.code())}/guests`,
        { displayName: this.name.trim(), organization: this.organization.trim() || null },
      );
      this.requestId = r.requestId;
      this.secret = r.secret;
      this.phase.set('waiting');
      await this.check();
      if (this.phase() === 'waiting') this.poll = setInterval(() => this.check(), 3000);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  private async check() {
    try {
      const s = await this.api.get<GuestStatus>(`/api/public/guests/${this.requestId}`, { 'X-Guest-Secret': this.secret });
      if (s.status === 'admitted' && s.livekit && s.guestToken) {
        clearInterval(this.poll);
        this.access = s.livekit;
        this.headers.set({ Authorization: `Bearer ${s.guestToken}` });
        this.phase.set('prejoin');
      } else if (s.status === 'denied') {
        clearInterval(this.poll);
        this.phase.set('denied');
      }
    } catch {
      /* nouvel essai au prochain passage */
    }
  }

  async join(opts: JoinOptions) {
    if (!this.access) return;
    this.error.set('');
    this.joining.set(true);
    const s = new RoomSession();
    try {
      await s.connect(this.access.url, this.access.token, opts);
      this.session.set(s);
      this.phase.set('room');
    } catch {
      await s.leave().catch(() => {});
      this.error.set('Connexion au serveur vidéo impossible. Vérifiez votre réseau.');
    } finally {
      this.joining.set(false);
    }
  }

  protected endText() {
    return {
      left: 'Vous avez quitté la réunion.',
      deleted: 'La réunion est terminée.',
      removed: 'L’organisateur vous a retiré de la réunion.',
      duplicate: 'Vous avez rejoint depuis un autre onglet.',
      lost: 'La connexion a été perdue.',
    }[this.endReason()];
  }

  onEnded(reason: EndReason) {
    this.endReason.set(reason);
    this.session.set(null);
    this.phase.set('ended');
  }
}
