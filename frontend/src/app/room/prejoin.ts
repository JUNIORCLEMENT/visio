import { Component, ElementRef, OnDestroy, OnInit, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  VideoPresets,
  createAudioAnalyser,
  createLocalAudioTrack,
  createLocalVideoTrack,
} from 'livekit-client';
import { Icon } from '../shared/icon';
import { JoinOptions, deviceErrorText } from './room-session';

/** Écran « Prêt à rejoindre ? » : aperçu caméra, test du micro, choix des appareils. */
@Component({
  selector: 'app-prejoin',
  imports: [FormsModule, Icon],
  template: `
    <div class="pre">
      <div class="preview">
        <video #video autoplay playsinline muted class="mirror" [hidden]="!camOn() || !!camError()"></video>
        @if (!camOn() || camError()) {
          <div class="off">{{ camError() || 'Caméra désactivée' }}</div>
        }
        <div class="bar">
          <button type="button" class="round" [class.off-btn]="!micOn()" (click)="toggleMic()"
            [attr.aria-label]="micOn() ? 'Couper le micro' : 'Activer le micro'" [attr.aria-pressed]="!micOn()">
            <app-icon [name]="micOn() ? 'mic' : 'micOff'" />
          </button>
          <button type="button" class="round" [class.off-btn]="!camOn()" (click)="toggleCam()"
            [attr.aria-label]="camOn() ? 'Couper la caméra' : 'Activer la caméra'" [attr.aria-pressed]="!camOn()">
            <app-icon [name]="camOn() ? 'cam' : 'camOff'" />
          </button>
        </div>
      </div>

      <div class="stack side">
        <div>
          <h1>Prêt à rejoindre ?</h1>
          <p class="sub">{{ subtitle() }}</p>
        </div>
        @if (!secure) {
          <div class="alert warn">Ce site n’est pas en HTTPS : le navigateur bloquera la caméra et le micro. Demandez l’adresse sécurisée à la DSID.</div>
        }
        <div class="field">
          <label for="cam-dev">Caméra</label>
          <select id="cam-dev" [ngModel]="videoDeviceId()" (ngModelChange)="pickVideo($event)">
            @for (d of videoDevices(); track d.deviceId) { <option [value]="d.deviceId">{{ d.label || 'Caméra' }}</option> }
            @empty { <option value="">Caméra par défaut</option> }
          </select>
        </div>
        <div class="field">
          <label for="mic-dev">Micro</label>
          <select id="mic-dev" [ngModel]="audioDeviceId()" (ngModelChange)="pickAudio($event)">
            @for (d of audioDevices(); track d.deviceId) { <option [value]="d.deviceId">{{ d.label || 'Micro' }}</option> }
            @empty { <option value="">Micro par défaut</option> }
          </select>
          <div class="meter" aria-hidden="true"><i [style.width.%]="level()"></i></div>
          @if (micError()) { <span class="hint">{{ micError() }}</span> }
        </div>
        @if (notice()) {
          <p class="notice"><span class="rec-dot" aria-hidden="true"></span>{{ notice() }}</p>
        }
        <button class="btn primary wide" type="button" [disabled]="busy()" (click)="join()">
          @if (busy()) { <span class="spin" aria-hidden="true"></span> } {{ joinLabel() }}
        </button>
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .pre { display: flex; gap: 24px; align-items: stretch; flex-wrap: wrap; }
    .preview { flex: 1 1 420px; position: relative; aspect-ratio: 16 / 10; background: var(--stage); border-radius: 24px; overflow: hidden; }
    video { width: 100%; height: 100%; object-fit: cover; display: block; }
    video[hidden] { display: none; }
    .mirror { transform: scaleX(-1); }
    .off { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #cfc9e0; padding: 24px; text-align: center; }
    .bar { position: absolute; bottom: 14px; left: 0; right: 0; display: flex; justify-content: center; gap: 12px; }
    .round { width: 48px; height: 48px; border-radius: 50%; border: none; background: rgba(255,255,255,.92); color: #16131F; display: flex; align-items: center; justify-content: center; }
    .round.off-btn { background: var(--red); color: #fff; }
    .side { flex: 1 1 300px; max-width: 420px; justify-content: center; }
    .notice { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
    .rec-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); flex: none; }
    .meter { height: 6px; border-radius: 999px; background: var(--panel); overflow: hidden; margin-top: 4px; }
    .meter i { display: block; height: 100%; background: var(--violet); transition: width .08s linear; }
  `,
})
export class Prejoin implements OnInit, OnDestroy {
  readonly subtitle = input('');
  readonly joinLabel = input('Rejoindre');
  readonly busy = input(false);
  /** Mention affichée avant d'entrer (ex. enregistrement) */
  readonly notice = input('');
  readonly joined = output<JoinOptions>();

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  protected readonly secure = window.isSecureContext;
  protected readonly micOn = signal(true);
  protected readonly camOn = signal(true);
  protected readonly camError = signal('');
  protected readonly micError = signal('');
  protected readonly level = signal(0);
  protected readonly videoDevices = signal<MediaDeviceInfo[]>([]);
  protected readonly audioDevices = signal<MediaDeviceInfo[]>([]);
  protected readonly videoDeviceId = signal('');
  protected readonly audioDeviceId = signal('');

  private videoTrack?: LocalVideoTrack;
  private audioTrack?: LocalAudioTrack;
  private analyserCleanup?: () => Promise<void>;
  private raf = 0;

  async ngOnInit() {
    await Promise.all([this.startVideo(), this.startAudio()]);
    await this.listDevices();
  }

  ngOnDestroy() {
    this.stopAll();
  }

  private async listDevices() {
    try {
      const [v, a] = await Promise.all([Room.getLocalDevices('videoinput', false), Room.getLocalDevices('audioinput', false)]);
      this.videoDevices.set(v);
      this.audioDevices.set(a);
      if (!this.videoDeviceId() && v[0]) this.videoDeviceId.set(this.videoTrack?.mediaStreamTrack.getSettings().deviceId ?? v[0].deviceId);
      if (!this.audioDeviceId() && a[0]) this.audioDeviceId.set(this.audioTrack?.mediaStreamTrack.getSettings().deviceId ?? a[0].deviceId);
    } catch {
      /* liste indisponible : on garde les appareils par défaut */
    }
  }

  private async startVideo() {
    this.stopVideo();
    if (!this.camOn()) return;
    try {
      this.camError.set('');
      this.videoTrack = await createLocalVideoTrack({
        deviceId: this.videoDeviceId() || undefined,
        resolution: VideoPresets.h540.resolution,
      });
      this.videoTrack.attach(this.video().nativeElement);
    } catch (e) {
      this.camError.set(deviceErrorText(e));
    }
  }

  private async startAudio() {
    this.stopAudio();
    if (!this.micOn()) return;
    try {
      this.micError.set('');
      this.audioTrack = await createLocalAudioTrack({ deviceId: this.audioDeviceId() || undefined });
      const { calculateVolume, cleanup } = createAudioAnalyser(this.audioTrack);
      this.analyserCleanup = cleanup;
      const tick = () => {
        this.level.set(Math.min(100, Math.round(calculateVolume() * 250)));
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      this.micError.set(deviceErrorText(e));
    }
  }

  private stopVideo() {
    if (this.videoTrack) {
      this.videoTrack.detach();
      this.videoTrack.stop();
      this.videoTrack = undefined;
    }
  }

  private stopAudio() {
    cancelAnimationFrame(this.raf);
    this.level.set(0);
    this.analyserCleanup?.().catch(() => {});
    this.analyserCleanup = undefined;
    this.audioTrack?.stop();
    this.audioTrack = undefined;
  }

  private stopAll() {
    this.stopVideo();
    this.stopAudio();
  }

  protected toggleCam() {
    this.camOn.update((v) => !v);
    this.startVideo();
  }

  protected toggleMic() {
    this.micOn.update((v) => !v);
    this.startAudio();
  }

  protected pickVideo(id: string) {
    this.videoDeviceId.set(id);
    this.startVideo();
  }

  protected pickAudio(id: string) {
    this.audioDeviceId.set(id);
    this.startAudio();
  }

  protected join() {
    // Libère la caméra et le micro : la salle les reprend avec les mêmes réglages
    this.stopAll();
    this.joined.emit({
      mic: this.micOn() && !this.micError(),
      cam: this.camOn() && !this.camError(),
      audioDeviceId: this.audioDeviceId() || undefined,
      videoDeviceId: this.videoDeviceId() || undefined,
    });
  }
}
