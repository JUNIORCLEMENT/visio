import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ApiError, errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { fmtDay, fmtTime } from '../../core/labels';
import { InvitationInfo, User } from '../../core/models';
import { AuthLayout } from '../../shared/auth-layout';
import { Icon } from '../../shared/icon';

type Phase = 'check' | 'info' | 'done' | 'bad';

@Component({
  selector: 'app-invitation-page',
  imports: [FormsModule, RouterLink, AuthLayout, Icon],
  template: `
    <app-auth-layout tagline="Votre compte vous attend. Vos informations viennent de l’annuaire HPO Mail.">
      <div class="stack box" aria-live="polite">
        <ol class="steps" aria-label="Étapes">
          <li [class.on]="phase() === 'check' || phase() === 'bad'" [class.done]="phase() === 'info' || phase() === 'done'"><i>1</i>Vérifier le lien</li>
          <li [class.on]="phase() === 'info'" [class.done]="phase() === 'done'"><i>2</i>Confirmer vos informations</li>
          <li [class.done]="phase() === 'done'"><i>3</i>Compte activé</li>
        </ol>

        @switch (phase()) {
          @case ('check') {
            <h1>Vérification du lien</h1>
            <div class="row"><span class="spin" aria-hidden="true"></span><span class="sub">Lecture de votre compte dans l’annuaire HPO Mail…</span></div>
          }
          @case ('bad') {
            <h1>{{ badTitle() }}</h1>
            <p class="sub">{{ badText() }}</p>
            <a class="btn ghost wide" routerLink="/connexion">Aller à la connexion</a>
          }
          @case ('info') {
            @if (info(); as inv) {
              <div>
                <h1>Confirmez vos informations</h1>
                <p class="sub">Invitation valable jusqu’au {{ expiry() }}</p>
              </div>
              <div class="dirbox">
                <div class="dh"><app-icon name="shield" [size]="14" /> Récupéré depuis l’annuaire HPO Mail</div>
                <dl>
                  <dt>Nom</dt><dd>{{ inv.profile.fullName }}</dd>
                  <dt>Adresse</dt><dd>{{ inv.email }}</dd>
                  <dt>Service</dt><dd>{{ inv.profile.department || 'Non renseigné' }}</dd>
                  <dt>Fonction</dt><dd>{{ inv.profile.jobTitle || 'Non renseignée' }}</dd>
                  <dt>Site</dt><dd>{{ inv.profile.site || 'Non renseigné' }}</dd>
                  @if (inv.profile.company) { <dt>Filiale</dt><dd>{{ inv.profile.company }}</dd> }
                  <dt>Rôle HPO Visio</dt><dd>{{ inv.roleLabel }}</dd>
                </dl>
              </div>
              <p class="hint">Une information est fausse ? Elle se corrige dans HPO Mail, pas ici : contactez la DSID.</p>
              <form class="stack" (ngSubmit)="activate()" novalidate>
                @if (inv.passwordMode === 'verify') {
                  <div class="field">
                    <label for="pwd">Mot de passe HPO Mail</label>
                    <input id="pwd" name="pwd" type="password" autocomplete="current-password" [(ngModel)]="password"
                      placeholder="Pour confirmer que c’est bien vous" required />
                  </div>
                } @else {
                  <div class="field">
                    <label for="pwd">Choisissez votre mot de passe HPO Visio</label>
                    <input id="pwd" name="pwd" type="password" autocomplete="new-password" [(ngModel)]="password" required />
                    <span class="hint">10 caractères minimum, avec au moins une lettre et un chiffre.</span>
                  </div>
                  <div class="field">
                    <label for="pwd2">Confirmez le mot de passe</label>
                    <input id="pwd2" name="pwd2" type="password" autocomplete="new-password" [(ngModel)]="confirm" required />
                  </div>
                }
                @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
                <button class="btn primary wide" type="submit" [disabled]="busy()">
                  @if (busy()) { <span class="spin" aria-hidden="true"></span> } Activer mon compte
                </button>
              </form>
            }
          }
          @case ('done') {
            <span class="ok-badge" aria-hidden="true"><app-icon name="check" [size]="28" /></span>
            <div>
              <h1>Compte activé</h1>
              <p class="sub">Bienvenue {{ firstName() }}. Votre compte {{ user()?.email }} est prêt, avec le rôle {{ info()?.roleLabel }}.</p>
            </div>
            <a class="btn primary wide" routerLink="/accueil">Accéder à HPO Visio</a>
            <p class="hint">La prochaine fois, connectez-vous directement avec votre adresse HPO Mail.</p>
          }
        }
      </div>
    </app-auth-layout>
  `,
  styles: `
    .box { max-width: 460px; width: 100%; }
    .steps { display: flex; gap: 10px; list-style: none; padding: 0; margin: 0; font-size: 12px; color: var(--faint); flex-wrap: wrap; }
    .steps li { display: flex; align-items: center; gap: 6px; }
    .steps i { width: 22px; height: 22px; border-radius: 50%; background: var(--panel); display: inline-flex; align-items: center;
      justify-content: center; font-style: normal; font-weight: 600; color: var(--muted); }
    .steps li.on { color: var(--ink); }
    .steps li.on i { background: var(--blue); color: #fff; }
    .steps li.done i { background: var(--blue-soft); color: var(--blue); }
    .dirbox { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
    .dh { background: var(--panel); padding: 10px 14px; font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
    dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 10px 16px; padding: 14px; }
    dt { font-size: 13px; color: var(--muted); }
    dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; }
    .ok-badge { width: 56px; height: 56px; border-radius: 50%; background: var(--blue); color: #fff; display: flex; align-items: center; justify-content: center; }
  `,
})
export class InvitationPage implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  readonly token = input.required<string>();

  protected readonly phase = signal<Phase>('check');
  protected readonly info = signal<InvitationInfo | null>(null);
  protected readonly user = signal<User | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly badTitle = signal('');
  protected readonly badText = signal('');
  protected password = '';
  protected confirm = '';

  async ngOnInit() {
    try {
      const inv = await this.api.get<InvitationInfo>(`/api/invitations/${encodeURIComponent(this.token())}`);
      this.info.set(inv);
      this.phase.set('info');
    } catch (e) {
      this.showBad(e);
    }
  }

  protected expiry() {
    const d = this.info()?.expiresAt;
    return d ? `${fmtDay(d)} à ${fmtTime(d)}` : '';
  }

  protected firstName() {
    return (this.user()?.fullName ?? '').split(' ')[0];
  }

  async activate() {
    this.error.set('');
    if (!this.password) {
      this.error.set(this.info()?.passwordMode === 'verify' ? 'Saisissez votre mot de passe HPO Mail.' : 'Choisissez un mot de passe.');
      return;
    }
    this.busy.set(true);
    try {
      const r = await this.api.post<{ user: User }>(`/api/invitations/${encodeURIComponent(this.token())}/accept`, {
        password: this.password,
        passwordConfirm: this.confirm,
      });
      this.auth.setUser(r.user);
      this.user.set(r.user);
      this.phase.set('done');
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) this.showBad(e);
      else this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
      this.password = '';
      this.confirm = '';
    }
  }

  private showBad(e: unknown) {
    const body = e instanceof ApiError ? (e.body as { title?: string; message?: string }) : {};
    this.badTitle.set(body.title ?? 'Lien non valide');
    this.badText.set(body.message ?? errorMessage(e));
    this.phase.set('bad');
  }
}
