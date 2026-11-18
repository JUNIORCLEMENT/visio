import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { ROLES, ROLE_LABELS, fmtRelative } from '../../core/labels';
import { AdminUser, Invitation, Role } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Avatar } from '../../shared/avatar';
import { Icon } from '../../shared/icon';
import { InviteDialog } from './invite-dialog';

const INV_STATUS: Record<Invitation['status'], [string, string]> = {
  pending: ['En attente', 'info'],
  expired: ['Expirée', 'warn'],
  accepted: ['Acceptée', 'ok'],
  revoked: ['Révoquée', 'off'],
  replaced: ['Remplacée', ''],
};

@Component({
  selector: 'app-admin-users',
  imports: [FormsModule, Avatar, Icon, InviteDialog],
  template: `
    <section class="card stack">
      <div class="between">
        <h2>Utilisateurs <span class="sub">({{ users().length }})</span></h2>
        <div class="row wrap">
          <label class="sr-only" for="u-search">Rechercher un utilisateur</label>
          <input id="u-search" class="input search" [(ngModel)]="search" (ngModelChange)="onSearch()" placeholder="Rechercher un nom, un service…" />
          <button class="btn ghost" type="button" (click)="sync()" [disabled]="busy()"><app-icon name="refresh" /> Synchroniser l’annuaire</button>
          <button class="btn ghost" type="button" (click)="csv.click()" [disabled]="busy()" title="Fichier CSV : email ; nom complet ; service ; fonction ; site ; filiale">
            <app-icon name="upload" /> Importer l’annuaire (CSV)
          </button>
          <input #csv type="file" accept=".csv,text/csv" hidden (change)="importCsv(csv)" />
          <button class="btn primary" type="button" (click)="inviting.set(true)"><app-icon name="plus" /> Inviter des utilisateurs</button>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Nom</th><th>Service</th><th>Site</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead>
          <tbody>
            @for (u of users(); track u.id) {
              <tr [class.dim]="u.status === 'disabled'">
                <td><span class="row"><app-avatar [name]="u.fullName" /><span><b>{{ u.fullName }}</b><br /><span class="hint">{{ u.email }}</span></span></span></td>
                <td>{{ u.department ?? '—' }}</td>
                <td>{{ u.site ?? '—' }}</td>
                <td>
                  <select [attr.aria-label]="'Rôle de ' + u.fullName" [ngModel]="u.role" (ngModelChange)="setRole(u, $event)" [disabled]="u.id === me()">
                    @for (r of roles; track r) { <option [value]="r">{{ roleLabel(r) }}</option> }
                  </select>
                </td>
                <td><span class="pill" [class.ok]="u.status === 'active'" [class.off]="u.status === 'disabled'">{{ u.status === 'active' ? 'Actif' : 'Désactivé' }}</span></td>
                <td>{{ rel(u.lastLoginAt) }}@if (u.lastLoginOrigin) { <br /><span class="hint">{{ u.lastLoginOrigin }}</span> }</td>
                <td>
                  @if (u.id !== me()) {
                    <button class="mini" [class.danger]="u.status === 'active'" type="button" (click)="toggleStatus(u)">
                      {{ u.status === 'active' ? 'Désactiver' : 'Réactiver' }}
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="empty">Aucun utilisateur.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <section class="card stack">
      <div>
        <h2>Invitations <span class="sub">({{ invitations().length }})</span></h2>
        <p class="sub">Envoyées sur la boîte HPO Mail. Chaque lien sert une seule fois.</p>
      </div>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Adresse HPO Mail</th><th>Rôle</th><th>Envoyée</th><th>Expire</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            @for (i of invitations(); track i.id) {
              <tr>
                <td><b>{{ i.fullName ?? i.email }}</b>@if (i.fullName) { <br /><span class="hint">{{ i.email }}</span> }</td>
                <td>{{ roleLabel(i.role) }}</td>
                <td>{{ rel(i.createdAt) }}@if (i.invitedBy) { <br /><span class="hint">par {{ i.invitedBy }}</span> }</td>
                <td>{{ i.status === 'accepted' ? '—' : rel(i.expiresAt) }}</td>
                <td><span class="pill {{ status(i)[1] }}">{{ status(i)[0] }}</span></td>
                <td class="acts">
                  @if (i.status !== 'accepted') { <button class="mini" type="button" (click)="resend(i)">Renvoyer</button> }
                  @if (i.status === 'pending') { <button class="mini danger" type="button" (click)="revoke(i)">Révoquer</button> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty">Aucune invitation envoyée.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (inviting()) {
      <app-invite-dialog (closed)="inviting.set(false)" (sent)="onInvited()" />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .wrap { flex-wrap: wrap; }
    .search { width: 240px; height: 42px; }
    tr.dim td { opacity: .6; }
    .acts { display: flex; gap: 6px; }
  `,
})
export class AdminUsers implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly toasts = inject(Toasts);

  protected readonly users = signal<AdminUser[]>([]);
  protected readonly invitations = signal<Invitation[]>([]);
  protected readonly inviting = signal(false);
  protected readonly busy = signal(false);
  protected readonly roles = ROLES;
  protected readonly rel = fmtRelative;
  protected search = '';
  private searchTimer?: ReturnType<typeof setTimeout>;

  protected me = () => this.auth.user()?.id;
  protected roleLabel = (r: Role) => ROLE_LABELS[r];
  protected status = (i: Invitation) => INV_STATUS[i.status];

  ngOnInit() {
    this.loadUsers();
    this.loadInvitations();
  }

  onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadUsers(), 250);
  }

  async loadUsers() {
    try {
      const r = await this.api.get<{ users: AdminUser[] }>(`/api/admin/users?search=${encodeURIComponent(this.search)}`);
      this.users.set(r.users);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  async loadInvitations() {
    try {
      const r = await this.api.get<{ invitations: Invitation[] }>('/api/admin/invitations');
      this.invitations.set(r.invitations);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  async setRole(u: AdminUser, role: Role) {
    try {
      await this.api.patch(`/api/admin/users/${u.id}`, { role });
      this.toasts.show(`${u.fullName} est maintenant ${ROLE_LABELS[role].toLowerCase()}.`);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
    await this.loadUsers();
  }

  async toggleStatus(u: AdminUser) {
    const status = u.status === 'active' ? 'disabled' : 'active';
    if (status === 'disabled' && !confirm(`Désactiver le compte de ${u.fullName} ? Sa session sera coupée.`)) return;
    try {
      await this.api.patch(`/api/admin/users/${u.id}`, { status });
      this.toasts.show(status === 'disabled' ? 'Compte désactivé.' : 'Compte réactivé.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
    await this.loadUsers();
  }

  async resend(i: Invitation) {
    try {
      await this.api.post(`/api/admin/invitations/${i.id}/resend`);
      this.toasts.show(`Nouveau lien envoyé à ${i.email}. L’ancien ne fonctionne plus.`);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
    await this.loadInvitations();
  }

  async revoke(i: Invitation) {
    if (!confirm(`Révoquer l’invitation de ${i.email} ?`)) return;
    try {
      await this.api.post(`/api/admin/invitations/${i.id}/revoke`);
      this.toasts.show('Invitation révoquée : le lien ne fonctionne plus.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
    await this.loadInvitations();
  }

  async sync() {
    this.busy.set(true);
    try {
      const r = await this.api.post<{ updated: number; missing: string[] }>('/api/admin/directory/sync');
      this.toasts.show(
        `${r.updated} compte(s) mis à jour depuis l’annuaire.` + (r.missing.length ? ` Absents de l’annuaire : ${r.missing.join(', ')}` : ''),
        'info',
        r.missing.length ? 9000 : 4000,
      );
      await this.loadUsers();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async importCsv(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.busy.set(true);
    try {
      const text = await file.text();
      const r = await this.api.postText<{ imported: number; total: number; skipped: { line: number; reason: string }[] }>(
        '/api/admin/directory/import',
        text,
      );
      const skipped = r.skipped.length ? ` ${r.skipped.length} ligne(s) ignorée(s) : ${r.skipped.slice(0, 3).map((s) => `l.${s.line} ${s.reason}`).join(' ; ')}` : '';
      this.toasts.show(`Annuaire : ${r.imported} / ${r.total} adresse(s) importée(s).${skipped}`, 'info', 9000);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  onInvited() {
    this.inviting.set(false);
    this.loadInvitations();
  }
}
