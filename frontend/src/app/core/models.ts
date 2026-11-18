export type Role = 'admin' | 'organizer' | 'user';

export interface User {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
  jobTitle: string | null;
  site: string | null;
  company: string | null;
  role: Role;
}

export interface AuthConfig {
  authProvider: 'local' | 'ldap' | 'imap';
  passwordMode: 'create' | 'verify';
  mailDomains: string[];
}

export interface DirectoryProfile {
  email: string;
  fullName: string;
  department: string | null;
  jobTitle: string | null;
  site: string | null;
  company: string | null;
}

export interface InvitationInfo {
  state: 'ok';
  email: string;
  role: Role;
  roleLabel: string;
  expiresAt: string;
  passwordMode: 'create' | 'verify';
  profile: DirectoryProfile;
}

export interface Meeting {
  id: string;
  code: string;
  kind?: 'meeting' | 'call';
  /** Enregistrement automatique actif (renvoyé par /join et le détail) */
  recording?: boolean;
  title: string;
  description: string | null;
  department: string | null;
  organizerId: string | null;
  organizerName: string | null;
  organizerEmail?: string | null;
  isPermanent: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  allowGuests: boolean;
  waitingRoom: boolean;
  recordingAllowed: boolean;
  status: 'scheduled' | 'live' | 'ended';
  startedAt: string | null;
  endedAt: string | null;
  participants: number;
  isHost: boolean;
}

export interface LiveKitAccess {
  url: string | null;
  token: string;
}

export interface ChatMessage {
  id: number;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface GuestRequest {
  id: string;
  displayName: string;
  organization: string | null;
  status: 'waiting' | 'admitted' | 'denied';
  createdAt: string;
}

export interface AdminUser extends User {
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  lastLoginOrigin: string | null;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'expired' | 'accepted' | 'revoked' | 'replaced';
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  invitedBy: string | null;
  fullName: string | null;
}

export interface Settings {
  allow_guests: boolean;
  guest_waiting_room: boolean;
  admin_2fa: boolean;
  external_2fa: boolean;
  recording_allowed: boolean;
  recording_retention_days: number;
  invitation_default_ttl: number;
}

export interface AuditLog {
  id: number;
  createdAt: string;
  actor: string;
  action: string;
  target: string | null;
  origin: string | null;
  ip: string | null;
}

export interface AdminStats {
  counts: {
    liveMeetings: number;
    liveParticipants: number;
    usersTotal: number;
    usersActive: number;
    usersToday: number;
    invitationsPending: number;
    failedLogins24h: number;
    recordings24h: number;
    recordingsFailed7d: number;
  };
  services: {
    database: string;
    livekit: 'ok' | 'down';
    smtp: 'ok' | 'down' | 'console' | 'unknown';
    mailMode: 'smtp' | 'console';
    directory: { provider: 'db' | 'ldap'; ok: boolean; entries?: number; lastUpdate?: string; error?: string };
    authProvider: string;
  };
  liveMeetings: Meeting[];
}

// ----- Version 2 : Activité, Contacts, appels, comptes rendus, enregistrements -----
export type NotificationType = 'meeting_invite' | 'meeting_reminder' | 'incoming_call' | 'missed_call' | 'call_declined';

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  meetingCode: string | null;
  createdAt: string;
  read: boolean;
}

export interface IncomingCall {
  notificationId: number;
  code: string;
  callerName: string;
  callerDepartment: string | null;
  createdAt: string;
}

export interface Contact {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
  jobTitle: string | null;
  site: string | null;
  company: string | null;
  online: boolean;
}

export interface ReportSummary {
  id: string;
  title: string;
  code: string;
  kind: 'meeting' | 'call';
  organizerName: string | null;
  startedAt: string;
  endedAt: string | null;
  participants: number;
  hasNotes: boolean;
  recorded: boolean;
}

export interface ReportDetail {
  id: string;
  meeting: {
    id: string;
    title: string;
    code: string;
    kind: 'meeting' | 'call';
    agenda: string | null;
    organizerName: string | null;
    organizerEmail: string | null;
    organizerDepartment: string | null;
  };
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  attendees: { identity: string; name: string; detail: string | null; isGuest: boolean; firstJoin: string; lastLeave: string; seconds: number }[];
  absent: { name: string; department: string | null }[];
  notes: string | null;
  decisions: string | null;
  actions: string | null;
  notesUpdatedAt: string | null;
  notesUpdatedBy: string | null;
  messages: { senderName: string; body: string; createdAt: string }[];
  recordings: { id: string; status: 'recording' | 'ready' | 'failed'; durationSeconds: number | null }[];
  canEdit: boolean;
}

export interface Recording {
  id: string;
  title: string;
  kind: 'meeting' | 'call';
  roomName: string;
  organizerName: string | null;
  status: 'recording' | 'ready' | 'failed';
  sizeBytes: number | null;
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  sessionId: string | null;
  available: boolean;
}
