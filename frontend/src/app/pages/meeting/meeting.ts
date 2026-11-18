import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, ApiError, errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { Meeting, LiveKitAccess } from '../../core/models';
import { Prejoin } from '../../room/prejoin';
import { RoomView } from '../../room/room';
import { EndReason, JoinOptions, RoomSession } from '../../room/room-session';

type Phase = 'loading' | 'missing' | 'prejoin' | 'room' | 'ended';

const CALL_END_TEXT: Record<EndReason, string> = {
  left: 'Appel terminé.',
  deleted: 'L’appel est terminé.',
  removed: 'L’appel a été interrompu.',
  duplicate: 'Vous avez répondu depuis un autre appareil.',
  lost: 'La connexion de l’appel a été perdue.',
};

const END_TEXT: Record<EndReason, string> = {
  left: 'Vous avez quitté la réunion.',
  deleted: 'La réunion a été terminée par l’organisateur.',
  removed: 'Vous avez été retiré de la réunion.',
  duplicate: 'Vous avez rejoint cette réunion depuis un autre appareil.',
  lost: 'La connexion à la réunion a été perdue.',
};

@Component({
  selector: 'app-meeting-page',
  imports: [RouterLink, Prejoin, RoomView],
  template: `
    @switch (phase()) {
      @case ('loading') {
        <div class="center"><span class="spin"></span></div>
      }
      @case ('missing') {
        <div class="center"><div class="card stack box">
          <h1>Réunion introuvable</h1>
          <p class="sub">{{ error() }}</p>
          <a class="btn primary" routerLink="/accueil">Retour à l’accueil</a>
        </div></div>
      }
      @case ('prejoin') {
        <div class="wrap">
          <div class="card">
            <app-prejoin [subtitle]="subtitle()" [busy]="joining()" [joinLabel]="joinLabel()" [notice]="notice()" (joined)="join($event)">
              @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
              <a [routerLink]="isCall() ? '/contacts' : '/accueil'" class="hint">{{ isCall() ? 'Annuler' : 'Retour à l’accueil' }}</a>
            </app-prejoin>
          </div>
        </div>
      }
      @case ('room') {
        @if (session(); as s) {
          <app-room [session]="s" [code]="code()" [title]="meeting()?.title ?? ''" [isHost]="!!meeting()?.isHost"
            [allowGuests]="!!meeting()?.allowGuests" [selfId]="selfId()" [recording]="!!meeting()?.recording"
            [kind]="isCall() ? 'call' : 'meeting'" (ended)="onEnded($event)" />
        }
      }
      @case ('ended') {
        <div class="center"><div class="card stack box">
          <h1>{{ endText() }}</h1>
          <p class="sub">{{ meeting()?.title }}</p>
          <div class="row">
            @if (!isCall() && endReason() !== 'deleted' && endReason() !== 'removed') {
              <button class="btn primary" type="button" (click)="phase.set('prejoin')">Rejoindre à nouveau</button>
            }
            @if (isCall()) {
              <a class="btn primary" routerLink="/contacts">Retour aux contacts</a>
            } @else {
              <a class="btn ghost" routerLink="/accueil">Retour à l’accueil</a>
            }
          </div>
        </div></div>
      }
    }
  `,
  styles: `
    :host { display: block; min-height: 100vh; }
    .center { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .box { max-width: 480px; width: 100%; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px; min-height: 100vh; display: flex; align-items: center; }
    .wrap .card { width: 100%; }
  `,
})
export class MeetingPage implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  readonly code = input.required<string>();

  protected readonly phase = signal<Phase>('loading');
  protected readonly meeting = signal<Meeting | null>(null);
  protected readonly session = signal<RoomSession | null>(null);
  protected readonly joining = signal(false);
  protected readonly error = signal('');
  protected readonly endReason = signal<EndReason>('left');

  async ngOnInit() {
    try {
      const r = await this.api.get<{ meeting: Meeting }>(`/api/meetings/${encodeURIComponent(this.code())}`);
      this.meeting.set(r.meeting);
      this.phase.set('prejoin');
    } catch (e) {
      this.error.set(errorMessage(e));
      this.phase.set('missing');
    }
  }

  protected isCall() {
    return this.meeting()?.kind === 'call';
  }

  protected joinLabel() {
    const m = this.meeting();
    if (!m) return 'Rejoindre';
    if (m.kind === 'call') return m.organizerId === this.auth.user()?.id ? 'Appeler' : 'Répondre';
    return m.isHost && !m.participants ? 'Démarrer la réunion' : 'Rejoindre';
  }

  protected notice() {
    if (!this.meeting()?.recording) return '';
    return this.isCall()
      ? 'Cet appel est enregistré et conservé par la DSID.'
      : 'Cette réunion est enregistrée et conservée par la DSID.';
  }

  protected subtitle() {
    const m = this.meeting();
    if (!m) return '';
    if (m.kind === 'call') return m.title.replace(/^Appel : /, '');
    const who = m.organizerName ? ` · ${m.organizerName}` : '';
    return `${m.title}${who}${m.participants ? ` · ${m.participants} personne(s) déjà présente(s)` : ''}`;
  }

  protected selfId() {
    return `u:${this.auth.user()?.id ?? ''}`;
  }

  protected endText() {
    return (this.isCall() ? CALL_END_TEXT : END_TEXT)[this.endReason()];
  }

  async join(opts: JoinOptions) {
    this.error.set('');
    this.joining.set(true);
    let s: RoomSession | null = null;
    try {
      const r = await this.api.post<{ livekit: LiveKitAccess; meeting: Meeting }>(`/api/meetings/${encodeURIComponent(this.code())}/join`);
      this.meeting.set({ ...r.meeting, isHost: this.meeting()?.isHost ?? false, recording: r.meeting.recording });
      s = new RoomSession();
      await s.connect(r.livekit.url, r.livekit.token, opts);
      this.session.set(s);
      this.phase.set('room');
    } catch (e) {
      await s?.leave().catch(() => {});
      this.error.set(
        e instanceof ApiError ? e.message : 'Connexion au serveur vidéo impossible. Vérifiez votre réseau ou contactez la DSID.',
      );
    } finally {
      this.joining.set(false);
    }
  }

  onEnded(reason: EndReason) {
    // Appel : raccrocher termine l'appel pour les deux (et le note « manqué » s'il n'a pas été décroché)
    if (this.isCall() && reason === 'left') {
      this.api.post(`/api/meetings/${encodeURIComponent(this.code())}/end`).catch(() => {});
    }
    this.endReason.set(reason);
    this.session.set(null);
    this.phase.set('ended');
  }
}
