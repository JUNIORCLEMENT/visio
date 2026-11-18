import {
  AccessToken,
  EncodedFileOutput,
  EncodedFileType,
  RoomCompositeEgressRequest,
  RoomEgress,
  RoomServiceClient,
  WebhookReceiver,
} from 'livekit-server-sdk';
import { config } from '../config.js';

/**
 * Pont vers le serveur média LiveKit (SFU).
 * L'API délivre des jetons d'accès signés ; les navigateurs se connectent
 * ensuite directement à LiveKit pour l'audio et la vidéo.
 */
const rooms = new RoomServiceClient(config.livekit.apiUrl, config.livekit.apiKey, config.livekit.apiSecret);

export async function createJoinToken({ identity, name, room, roomAdmin = false, canPublish = true, metadata = {} }) {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity,
    name,
    ttl: '6h',
    metadata: JSON.stringify(metadata),
  });
  at.addGrant({
    room,
    roomJoin: true,
    roomAdmin,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
  });
  return at.toJwt();
}

/** URL donnée au navigateur. Vide = même origine que le site (nginx relaie /rtc). */
export const publicUrl = () => config.livekit.publicUrl || null;

const withTimeout = (p, ms = 4000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('LiveKit ne répond pas')), ms))]);

/** Salles actives : Map(nom → nombre de participants). Map vide si LiveKit est injoignable. */
export async function activeRooms() {
  try {
    const list = await withTimeout(rooms.listRooms());
    return new Map(list.map((r) => [r.name, r.numParticipants]));
  } catch {
    return new Map();
  }
}

export async function liveKitStatus() {
  try {
    await withTimeout(rooms.listRooms());
    return 'ok';
  } catch {
    return 'down';
  }
}

/**
 * Ouvre la salle LiveKit avant la première connexion.
 * Si l'enregistrement est activé, LiveKit Egress démarre automatiquement l'enregistrement
 * de toute la salle (vidéo en mosaïque + son) dès qu'elle s'ouvre.
 * Sans effet si la salle est déjà ouverte.
 */
export async function prepareRoom(meeting, { record }) {
  const opts = {
    name: meeting.code,
    emptyTimeout: meeting.kind === 'call' ? 60 : 300,
    departureTimeout: meeting.kind === 'call' ? 15 : 60,
  };
  if (record) {
    opts.egress = new RoomEgress({
      room: new RoomCompositeEgressRequest({
        layout: config.recording.layout,
        fileOutputs: [
          new EncodedFileOutput({
            fileType: EncodedFileType.MP4,
            filepath: `${config.recording.egressDir.replace(/\/$/, '')}/{room_name}-{time}.mp4`,
          }),
        ],
      }),
    });
  }
  try {
    await withTimeout(rooms.createRoom(opts));
    return true;
  } catch (err) {
    console.warn(`[livekit] ouverture de la salle ${meeting.code} impossible : ${err.message}`);
    return false;
  }
}

/** Vérifie la signature des webhooks envoyés par LiveKit. */
export const webhookReceiver = new WebhookReceiver(config.livekit.apiKey, config.livekit.apiSecret);

/** Ferme la salle : tous les participants sont déconnectés. */
export async function closeRoom(name) {
  try {
    await withTimeout(rooms.deleteRoom(name));
    return true;
  } catch {
    return false;
  }
}

export async function removeParticipant(room, identity) {
  try {
    await withTimeout(rooms.removeParticipant(room, identity));
    return true;
  } catch {
    return false;
  }
}
