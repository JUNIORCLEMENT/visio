import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../core/api';
import { fmtTime } from '../core/labels';
import { ChatMessage, GuestRequest } from '../core/models';
import { Toasts } from '../core/toast';
import { Avatar } from '../shared/avatar';
import { Icon } from '../shared/icon';
import { EndReason, RoomSession } from './room-session';
import { Tile } from './tile';

type Panel = 'people' | 'chat' | null;

/** Salle de réunion : vidéo, contrôles, participants, discussion et salle d'attente. */
@Component({
  selector: 'app-room',
  imports: [FormsModule, Tile, Icon, Avatar],
  template: `
    <div class="room">
      <header class="top">
        <div class="grow">
          <h1 class="ellipsis">{{ title() }}</h1>
          <p class="meta"><span class="mono">{{ code() }}</span> · {{ session().people().length }} participant(s) · {{ elapsed() }}</p>
        </div>
        @if (recording()) {
          <span class="rec" title="Enregistrement automatique, conservé par la DSID"><span class="rec-dot"></span>Enregistrement</span>
        }
        @if (isHost() && allowGuests()) {
          <button class="chip" type="button" (click)="copyGuestLink()"><app-icon name="link" [size]="16" /> Lien invité</button>
        }
      </header>

      @if (kind() === 'call' && session().people().length < 2 && session().state() === 'connected') {
        <div class="banner waiting"><span class="spin light" aria-hidden="true"></span> Sonnerie en cours… en attente de réponse.</div>
      }
      @if (session().state() === 'reconnecting') {
        <div class="banner">Connexion perdue, reconnexion en cours…</div>
      }
      @if (session().audioBlocked()) {
        <button class="banner action" type="button" (click)="session().startAudio()">Le navigateur a bloqué le son. Cliquez ici pour l’activer.</button>
      }
      @if (session().deviceError()) {
        <div class="banner warn">{{ session().deviceError() }} <button type="button" (click)="session().deviceError.set('')" aria-label="Fermer">×</button></div>
      }
      @if (isHost() && waiting().length) {
        <div class="banner waiting">
          <span class="grow">{{ waiting()[0].displayName }}@if (waiting()[0].organization) { ({{ waiting()[0].organization }}) } attend dans la salle d’attente
            @if (waiting().length > 1) { (+{{ waiting().length - 1 }}) }</span>
          <button class="mini primary" type="button" (click)="decide(waiting()[0], 'admit')">Admettre</button>
          <button class="mini" type="button" (click)="decide(waiting()[0], 'deny')">Refuser</button>
        </div>
      }

      <div class="body">
        <section class="stage" [class.spot]="!!screenTile()" [style.--cols]="cols()" aria-label="Participants en vidéo">
          @if (screenTile(); as st) {
            <div class="main"><app-tile [tile]="st" /></div>
            <div class="strip">
              @for (t of otherTiles(); track t.key) { <app-tile [tile]="t" /> }
            </div>
          } @else {
            @for (t of session().tiles(); track t.key) { <app-tile [tile]="t" /> }
          }
        </section>

        @if (panel()) {
          <aside class="side" [attr.aria-label]="panel() === 'chat' ? 'Discussion' : 'Participants'">
            <div class="side-head">
              <div class="tabs">
                <button type="button" [class.on]="panel() === 'people'" (click)="panel.set('people')">Participants</button>
                <button type="button" [class.on]="panel() === 'chat'" (click)="openChat()">Discussion</button>
              </div>
              <button class="icon-btn" type="button" (click)="panel.set(null)" aria-label="Fermer le panneau"><app-icon name="close" /></button>
            </div>

            @if (panel() === 'people') {
              <div class="list">
                @if (isHost() && waiting().length) {
                  <h3 class="sec">Salle d’attente</h3>
                  @for (g of waiting(); track g.id) {
                    <div class="person">
                      <app-avatar [name]="g.displayName" />
                      <div class="grow"><b class="ellipsis">{{ g.displayName }}</b><span class="sub ellipsis">{{ g.organization || 'Invité externe' }}</span></div>
                      <button class="mini primary" type="button" (click)="decide(g, 'admit')">Admettre</button>
                      <button class="mini" type="button" (click)="decide(g, 'deny')" aria-label="Refuser">×</button>
                    </div>
                  }
                  <h3 class="sec">Dans la réunion</h3>
                }
                @for (p of session().people(); track p.identity) {
                  <div class="person">
                    <app-avatar [name]="p.name" />
                    <div class="grow">
                      <b class="ellipsis">{{ p.name }}@if (p.isLocal) { (vous) }</b>
                      <span class="sub">{{ p.kind === 'host' ? 'Organisateur' : p.kind === 'guest' ? 'Invité externe' : 'Collaborateur' }}</span>
                    </div>
                    <span class="state" [class.muted]="!p.micOn"><app-icon [name]="p.micOn ? 'mic' : 'micOff'" [size]="16" /></span>
                    @if (isHost() && p.kind === 'guest' && !p.isLocal) {
                      <button class="mini danger" type="button" (click)="removeGuest(p.identity)">Retirer</button>
                    }
                  </div>
                }
              </div>
            } @else {
              <div class="chat" #chatBox>
                @for (m of messages(); track m.id) {
                  <div class="msg" [class.me]="m.senderId === selfId()">
                    <div class="who"><b>{{ m.senderId === selfId() ? 'Vous' : m.senderName }}</b><span>{{ time(m.createdAt) }}</span></div>
                    <div class="bub">{{ m.body }}</div>
                  </div>
                } @empty {
                  <p class="empty">Les messages sont visibles par tous les participants.</p>
                }
              </div>
              <form class="composer" (ngSubmit)="send()">
                <label class="sr-only" for="chat-input">Écrire un message</label>
                <input id="chat-input" name="msg" class="input" [(ngModel)]="draft" maxlength="2000" placeholder="Écrire un message…" autocomplete="off" />
                <button class="btn primary sm" type="submit" [disabled]="!draft.trim()">Envoyer</button>
              </form>
            }
          </aside>
        }
      </div>

      <footer class="controls" aria-label="Contrôles de la réunion">
        <button type="button" class="ctl" [class.off]="!session().micOn()" (click)="session().toggleMic()"
          [attr.aria-label]="session().micOn() ? 'Couper le micro' : 'Activer le micro'" [attr.aria-pressed]="!session().micOn()">
          <app-icon [name]="session().micOn() ? 'mic' : 'micOff'" />
        </button>
        <button type="button" class="ctl" [class.off]="!session().camOn()" (click)="session().toggleCam()"
          [attr.aria-label]="session().camOn() ? 'Couper la caméra' : 'Activer la caméra'" [attr.aria-pressed]="!session().camOn()">
          <app-icon [name]="session().camOn() ? 'cam' : 'camOff'" />
        </button>
        @if (canShare) {
          <button type="button" class="ctl" [class.on]="session().screenOn()" (click)="session().toggleScreen()"
            [attr.aria-label]="session().screenOn() ? 'Arrêter le partage d’écran' : 'Partager l’écran'" [attr.aria-pressed]="session().screenOn()">
            <app-icon name="screen" />
          </button>
        }
        <button type="button" class="ctl" [class.on]="panel() === 'people'" (click)="toggle('people')" aria-label="Participants">
          <app-icon name="people" />
          @if (isHost() && waiting().length) { <span class="badge">{{ waiting().length }}</span> }
        </button>
        <button type="button" class="ctl" [class.on]="panel() === 'chat'" (click)="toggle('chat')" aria-label="Discussion">
          <app-icon name="chat" />
          @if (unread()) { <span class="badge">{{ unread() }}</span> }
        </button>
        <button type="button" class="ctl leave" (click)="leave()" aria-label="Quitter la réunion">
          <app-icon name="hangup" />
        </button>
        @if (isHost() && kind() !== 'call') {
          <button type="button" class="btn danger sm end" (click)="endForAll()">Terminer pour tous</button>
        }
      </footer>
    </div>
  `,
  styleUrl: './room.scss',
})
export class RoomView implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  readonly session = input.required<RoomSession>();
  readonly code = input.required<string>();
  readonly title = input.required<string>();
  readonly isHost = input(false);
  readonly allowGuests = input(false);
  /** Enregistrement automatique en cours (bandeau « Enregistrement ») */
  readonly recording = input(false);
  readonly kind = input<'meeting' | 'call'>('meeting');
  /** Identifiant LiveKit de la personne connectée : « u:… » ou « g:… » */
  readonly selfId = input.required<string>();
  /** En-têtes pour l'API (jeton invité) */
  readonly authHeaders = input<Record<string, string>>({});
  readonly ended = output<EndReason>();

  protected readonly panel = signal<Panel>(null);
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly unread = signal(0);
  protected readonly waiting = signal<GuestRequest[]>([]);
  protected readonly elapsed = signal('');
  protected draft = '';
  protected readonly canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  protected readonly time = fmtTime;
  private readonly chatBox = viewChild<ElementRef<HTMLElement>>('chatBox');

  protected readonly screenTile = computed(() => this.session().tiles().find((t) => t.isScreen) ?? null);
  protected readonly otherTiles = computed(() => {
    const st = this.screenTile();
    return this.session().tiles().filter((t) => t !== st);
  });
  protected readonly cols = computed(() => {
    const n = this.session().tiles().length;
    return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  });

  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly startedAt = Date.now();
  private knownWaiting = new Set<string>();

  constructor() {
    // Fin de la connexion (quitté, réunion terminée, retiré…) → on prévient la page
    effect(() => {
      const reason = this.session().ended();
      if (reason) this.ended.emit(reason);
    });
    // Défilement automatique de la discussion
    effect(() => {
      this.messages();
      const box = this.chatBox()?.nativeElement;
      if (box) queueMicrotask(() => (box.scrollTop = box.scrollHeight));
    });
  }

  async ngOnInit() {
    this.session().onChat = (m) => this.addMessage(m, true);
    this.tickClock();
    this.timers.push(setInterval(() => this.tickClock(), 15_000));
    await this.loadMessages();
    if (this.isHost()) {
      await this.pollWaiting();
      this.timers.push(setInterval(() => this.pollWaiting(), 4000));
    }
  }

  ngOnDestroy() {
    this.timers.forEach(clearInterval);
    this.session().leave();
  }

  private tickClock() {
    const min = Math.floor((Date.now() - this.startedAt) / 60_000);
    this.elapsed.set(min < 1 ? 'à l’instant' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);
  }

  protected toggle(p: Exclude<Panel, null>) {
    if (this.panel() === p) this.panel.set(null);
    else if (p === 'chat') this.openChat();
    else this.panel.set(p);
  }

  protected openChat() {
    this.panel.set('chat');
    this.unread.set(0);
  }

  // ---------- Discussion ----------
  private async loadMessages() {
    try {
      const r = await this.api.get<{ messages: ChatMessage[] }>(`/api/meetings/${this.code()}/messages`, this.authHeaders());
      this.messages.set(r.messages);
    } catch {
      /* historique indisponible : la discussion reste utilisable */
    }
  }

  private addMessage(m: ChatMessage, fromOthers: boolean) {
    if (this.messages().some((x) => x.id === m.id)) return;
    this.messages.update((l) => [...l, m]);
    if (fromOthers && this.panel() !== 'chat') this.unread.update((n) => n + 1);
  }

  protected async send() {
    const body = this.draft.trim();
    if (!body) return;
    this.draft = '';
    try {
      const r = await this.api.post<{ message: ChatMessage }>(`/api/meetings/${this.code()}/messages`, { body }, this.authHeaders());
      this.addMessage(r.message, false);
      await this.session().broadcastChat(r.message);
    } catch (e) {
      this.toasts.error(errorMessage(e));
      this.draft = body;
    }
  }

  // ---------- Salle d'attente (organisateur) ----------
  private async pollWaiting() {
    try {
      const r = await this.api.get<{ guests: GuestRequest[] }>(`/api/meetings/${this.code()}/guests`);
      const w = r.guests.filter((g) => g.status === 'waiting');
      for (const g of w) {
        if (!this.knownWaiting.has(g.id)) {
          this.knownWaiting.add(g.id);
          this.playChime();
        }
      }
      this.waiting.set(w);
    } catch {
      /* nouvel essai au prochain passage */
    }
  }

  protected async decide(g: GuestRequest, decision: 'admit' | 'deny') {
    try {
      await this.api.post(`/api/meetings/${this.code()}/guests/${g.id}/${decision}`);
      this.waiting.update((l) => l.filter((x) => x.id !== g.id));
      this.toasts.show(decision === 'admit' ? `${g.displayName} a été admis.` : `${g.displayName} a été refusé.`);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected async removeGuest(identity: string) {
    const id = identity.replace(/^g:/, '');
    try {
      await this.api.post(`/api/meetings/${this.code()}/guests/${id}/remove`);
      this.toasts.show('Invité retiré de la réunion.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  private playChime() {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.4);
      setTimeout(() => ctx.close(), 600);
    } catch {
      /* son facultatif */
    }
  }

  // ---------- Fin ----------
  protected async copyGuestLink() {
    const link = `${location.origin}/rejoindre/${this.code()}`;
    try {
      await navigator.clipboard.writeText(link);
      this.toasts.show('Lien invité copié.');
    } catch {
      this.toasts.show(link, 'info', 8000);
    }
  }

  protected leave() {
    this.session().leave();
  }

  protected async endForAll() {
    if (!confirm('Terminer la réunion pour tous les participants ?')) return;
    try {
      await this.api.post(`/api/meetings/${this.code()}/end`);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }
}
