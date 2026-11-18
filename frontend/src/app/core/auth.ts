import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, ApiError } from './api';
import { AuthConfig, User } from './models';

export type LoginResult = { user: User } | { mfaRequired: true; challengeId: string; sentTo: string };

/** Session du collaborateur (cookie HttpOnly posé par l'API). */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  readonly user = signal<User | null>(null);
  readonly config = signal<AuthConfig | null>(null);
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
  readonly canOrganize = computed(() => !!this.user()); // Tous les utilisateurs connectés peuvent créer une réunion

  private loaded: Promise<void> | null = null;

  /** Charge la session une seule fois au démarrage. */
  ensureLoaded(): Promise<void> {
    this.loaded ??= this.refresh();
    return this.loaded;
  }

  async refresh(): Promise<void> {
    try {
      const r = await this.api.get<{ user: User }>('/api/auth/me');
      this.user.set(r.user);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) console.warn('Session :', e);
      this.user.set(null);
    }
  }

  async loadConfig(): Promise<AuthConfig> {
    const cached = this.config();
    if (cached) return cached;
    const c = await this.api.get<AuthConfig>('/api/auth/config');
    this.config.set(c);
    return c;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const r = await this.api.post<LoginResult>('/api/auth/login', { email, password });
    if ('user' in r) this.user.set(r.user);
    return r;
  }

  async verify(challengeId: string, code: string): Promise<User> {
    const r = await this.api.post<{ user: User }>('/api/auth/verify', { challengeId, code });
    this.user.set(r.user);
    return r.user;
  }

  setUser(u: User) {
    this.user.set(u);
    this.loaded = Promise.resolve();
  }

  async logout() {
    await this.api.post('/api/auth/logout').catch(() => {});
    this.user.set(null);
    await this.router.navigateByUrl('/connexion');
  }
}
