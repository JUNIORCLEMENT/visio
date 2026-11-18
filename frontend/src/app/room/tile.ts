import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, viewChild } from '@angular/core';
import { ConnectionQuality } from 'livekit-client';
import { Avatar } from '../shared/avatar';
import { Icon } from '../shared/icon';
import { TileVM } from './room-session';

/** Vignette d'un participant (caméra ou partage d'écran). */
@Component({
  selector: 'app-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Avatar, Icon],
  template: `
    <div class="tile" [class.speaking]="tile().speaking && !tile().isScreen" [class.screen]="tile().isScreen">
      <video #video autoplay playsinline muted [class.mirror]="tile().isLocal && !tile().isScreen" [hidden]="!track()"></video>
      @if (!track()) {
        <div class="placeholder"><app-avatar [name]="tile().name" size="l" /></div>
      }
      <div class="label">
        @if (!tile().micOn && !tile().isScreen) { <app-icon name="micOff" [size]="14" /> }
        <span class="ellipsis">{{ label() }}</span>
        @if (tile().kind === 'host' && !tile().isScreen) { <span class="tag">Organisateur</span> }
      </div>
      @if (poor()) { <span class="net" title="Connexion faible">Connexion faible</span> }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; min-height: 0; }
    .tile { position: relative; width: 100%; height: 100%; min-height: 120px; background: var(--tile); border-radius: 18px; overflow: hidden;
      outline: 3px solid transparent; outline-offset: -3px; transition: outline-color .15s; }
    .tile.speaking { outline-color: var(--violet); }
    video { width: 100%; height: 100%; object-fit: cover; display: block; background: #000; }
    video[hidden] { display: none; }
    .tile.screen video { object-fit: contain; }
    video.mirror { transform: scaleX(-1); }
    .placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .label { position: absolute; left: 10px; bottom: 10px; max-width: calc(100% - 20px); display: flex; align-items: center; gap: 6px;
      background: rgba(10, 8, 18, .62); color: #fff; padding: 5px 10px; border-radius: 999px; font-size: 12px; }
    .tag { background: rgba(255,255,255,.18); border-radius: 999px; padding: 1px 8px; font-size: 11px; flex: none; }
    @media (max-width: 560px) { .tag { display: none; } }
    .net { position: absolute; top: 10px; right: 10px; background: rgba(229, 50, 59, .85); color: #fff; font-size: 11px; padding: 3px 8px; border-radius: 999px; }
  `,
})
export class Tile {
  readonly tile = input.required<TileVM>();
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  /** Ne change que si la piste change vraiment : évite de rattacher la vidéo à chaque rafraîchissement. */
  protected readonly track = computed(() => this.tile().track);
  protected readonly label = computed(() => {
    const t = this.tile();
    const name = t.isLocal ? `${t.name} (vous)` : t.name;
    return t.isScreen ? `Écran de ${name}` : name;
  });
  protected readonly poor = computed(() => !this.tile().isLocal && this.tile().quality === ConnectionQuality.Poor);

  constructor() {
    effect((onCleanup) => {
      const track = this.track();
      const el = this.video().nativeElement;
      if (!track) return;
      track.attach(el);
      onCleanup(() => track.detach(el));
    });
  }
}
