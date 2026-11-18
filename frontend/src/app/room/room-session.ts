import { signal } from '@angular/core';
import {
  ConnectionQuality,
  DisconnectReason,
  Participant,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type VideoTrack,
} from 'livekit-client';
import { ChatMessage } from '../core/models';

export type ParticipantKind = 'host' | 'member' | 'guest';

export interface TileVM {
  key: string;
  identity: string;
  name: string;
  isLocal: boolean;
  isScreen: boolean;
  track: VideoTrack | null;
  micOn: boolean;
  camOn: boolean;
  speaking: boolean;
  kind: ParticipantKind;
  quality: ConnectionQuality;
}

export interface PersonVM {
  identity: string;
  name: string;
  isLocal: boolean;
  micOn: boolean;
  camOn: boolean;
  speaking: boolean;
  kind: ParticipantKind;
}

export type EndReason = 'left' | 'deleted' | 'removed' | 'duplicate' | 'lost';

export interface JoinOptions {
  mic: boolean;
  cam: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

/** URL du serveur LiveKit : celle de l'API, sinon la même origine que le site (nginx relaie /rtc). */
export function resolveLiveKitUrl(url: string | null): string {
  if (url) return url;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

/**
 * Une connexion à une salle LiveKit, exposée sous forme de signaux Angular.
 * Une instance par réunion ; appeler leave() en sortant.
 */
export class RoomSession {
  readonly room = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    publishDefaults: { simulcast: true },
  });

  readonly tiles = signal<TileVM[]>([]);
  readonly people = signal<PersonVM[]>([]);
  readonly state = signal<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  readonly micOn = signal(false);
  readonly camOn = signal(false);
  readonly screenOn = signal(false);
  readonly audioBlocked = signal(false);
  readonly ended = signal<EndReason | null>(null);
  readonly deviceError = signal('');

  /** Message de discussion reçu d'un autre participant (diffusé par LiveKit). */
  onChat: (m: ChatMessage) => void = () => {};

  private readonly audioEls = new Map<string, HTMLMediaElement[]>();
  private refreshQueued = false;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor() {
    const r = this.room;
    const refreshOn = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.ParticipantMetadataChanged,
      RoomEvent.ConnectionQualityChanged,
    ] as const;
    for (const ev of refreshOn) r.on(ev as RoomEvent.ParticipantConnected, () => this.queueRefresh());

    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.style.display = 'none';
        document.body.appendChild(el);
        this.audioEls.set(track.sid ?? String(Math.random()), [el]);
      }
    });
    r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((el) => el.remove());
        if (track.sid) this.audioEls.delete(track.sid);
      }
    });
    r.on(RoomEvent.AudioPlaybackStatusChanged, () => this.audioBlocked.set(!r.canPlaybackAudio));
    r.on(RoomEvent.Reconnecting, () => this.state.set('reconnecting'));
    r.on(RoomEvent.Reconnected, () => this.state.set('connected'));
    r.on(RoomEvent.MediaDevicesError, (e: Error) => this.deviceError.set(deviceErrorText(e)));
    r.on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
      if (topic !== 'chat') return;
      try {
        const msg = JSON.parse(this.decoder.decode(payload)) as ChatMessage;
        if (msg && typeof msg.body === 'string') this.onChat(msg);
      } catch {
        /* message illisible : ignoré */
      }
    });
    r.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      this.state.set('disconnected');
      this.cleanupAudio();
      const map: Partial<Record<DisconnectReason, EndReason>> = {
        [DisconnectReason.CLIENT_INITIATED]: 'left',
        [DisconnectReason.ROOM_DELETED]: 'deleted',
        [DisconnectReason.PARTICIPANT_REMOVED]: 'removed',
        [DisconnectReason.DUPLICATE_IDENTITY]: 'duplicate',
      };
      this.ended.set((reason !== undefined && map[reason]) || 'lost');
    });
  }

  async connect(url: string | null, token: string, opts: JoinOptions) {
    this.state.set('connecting');
    await this.room.connect(resolveLiveKitUrl(url), token);
    this.state.set('connected');
    this.audioBlocked.set(!this.room.canPlaybackAudio);
    const lp = this.room.localParticipant;
    try {
      await lp.setMicrophoneEnabled(opts.mic, opts.audioDeviceId ? { deviceId: opts.audioDeviceId } : undefined);
    } catch (e) {
      this.deviceError.set(deviceErrorText(e));
    }
    try {
      await lp.setCameraEnabled(opts.cam, opts.videoDeviceId ? { deviceId: opts.videoDeviceId } : undefined);
    } catch (e) {
      this.deviceError.set(deviceErrorText(e));
    }
    this.refresh();
  }

  async toggleMic() {
    try {
      await this.room.localParticipant.setMicrophoneEnabled(!this.micOn());
    } catch (e) {
      this.deviceError.set(deviceErrorText(e));
    }
    this.refresh();
  }

  async toggleCam() {
    try {
      await this.room.localParticipant.setCameraEnabled(!this.camOn());
    } catch (e) {
      this.deviceError.set(deviceErrorText(e));
    }
    this.refresh();
  }

  async toggleScreen() {
    try {
      await this.room.localParticipant.setScreenShareEnabled(!this.screenOn(), { audio: true });
    } catch (e) {
      // L'utilisateur a annulé le choix de l'écran : pas une erreur
      if (!(e instanceof Error && e.name === 'NotAllowedError')) this.deviceError.set(deviceErrorText(e));
    }
    this.refresh();
  }

  async startAudio() {
    await this.room.startAudio();
    this.audioBlocked.set(!this.room.canPlaybackAudio);
  }

  async broadcastChat(msg: ChatMessage) {
    await this.room.localParticipant.publishData(this.encoder.encode(JSON.stringify(msg)), { reliable: true, topic: 'chat' });
  }

  async leave() {
    if (this.room.state !== 'disconnected') await this.room.disconnect();
    this.cleanupAudio();
  }

  private cleanupAudio() {
    for (const els of this.audioEls.values()) els.forEach((el) => el.remove());
    this.audioEls.clear();
  }

  private queueRefresh() {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  refresh() {
    const lp = this.room.localParticipant;
    const all: Participant[] = [lp, ...this.room.remoteParticipants.values()];
    const tiles: TileVM[] = [];
    const people: PersonVM[] = [];

    for (const p of all) {
      const kind = participantKind(p);
      const name = p.name || p.identity;
      const isLocal = p.identity === lp.identity;
      const cam = p.getTrackPublication(Track.Source.Camera);
      const screen = p.getTrackPublication(Track.Source.ScreenShare);
      const base = {
        identity: p.identity,
        name,
        isLocal,
        micOn: p.isMicrophoneEnabled,
        camOn: p.isCameraEnabled,
        speaking: p.isSpeaking,
        kind,
        quality: p.connectionQuality,
      };
      if (screen?.videoTrack && !screen.isMuted) {
        tiles.push({ ...base, key: p.identity + ':screen', isScreen: true, track: screen.videoTrack as VideoTrack });
      }
      tiles.push({
        ...base,
        key: p.identity + ':cam',
        isScreen: false,
        track: cam?.videoTrack && !cam.isMuted ? (cam.videoTrack as VideoTrack) : null,
      });
      people.push({ identity: p.identity, name, isLocal, micOn: base.micOn, camOn: base.camOn, speaking: base.speaking, kind });
    }

    // Partages d'écran d'abord, puis l'ordre d'arrivée (vous en premier)
    tiles.sort((a, b) => Number(b.isScreen) - Number(a.isScreen));
    this.tiles.set(tiles);
    this.people.set(people);
    this.micOn.set(lp.isMicrophoneEnabled);
    this.camOn.set(lp.isCameraEnabled);
    this.screenOn.set(lp.isScreenShareEnabled);
  }
}

function participantKind(p: Participant): ParticipantKind {
  try {
    const meta = JSON.parse(p.metadata || '{}') as { kind?: ParticipantKind };
    if (meta.kind === 'host' || meta.kind === 'guest') return meta.kind;
  } catch {
    /* métadonnées absentes */
  }
  return p.identity.startsWith('g:') ? 'guest' : 'member';
}

export function deviceErrorText(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError') return 'Accès à la caméra ou au micro refusé. Autorisez-le dans les réglages du navigateur.';
  if (name === 'NotFoundError') return 'Aucune caméra ou aucun micro trouvé sur cet appareil.';
  if (name === 'NotReadableError') return 'La caméra ou le micro est déjà utilisé par une autre application.';
  if (!window.isSecureContext) return 'La caméra et le micro exigent une connexion sécurisée (HTTPS).';
  return e instanceof Error ? e.message : 'Problème de caméra ou de micro.';
}
