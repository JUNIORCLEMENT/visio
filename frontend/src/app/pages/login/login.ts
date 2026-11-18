import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { AuthConfig } from '../../core/models';
import { AuthLayout } from '../../shared/auth-layout';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule, RouterLink, AuthLayout, Icon],
  template: `
    <app-auth-layout>
      @if (step() === 'credentials') {

        <div class="login-wrap">
          <div class="login-head">
            <h1>Bon retour 👋</h1>
            <p>Connectez-vous à votre espace HPO Visio.</p>
          </div>

          <form class="login-form" (ngSubmit)="submit()" novalidate>

            <div class="field">
              <label for="email">Adresse e-mail</label>
              <div class="inp-box">
                <svg class="inp-ico" viewBox="0 0 20 20" fill="none">
                  <path d="M2.5 5.833A1.667 1.667 0 0 1 4.167 4.167h11.666A1.667 1.667 0 0 1 17.5 5.833v8.334A1.667 1.667 0 0 1 15.833 15.833H4.167A1.667 1.667 0 0 1 2.5 14.167V5.833Z" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M2.5 6.667 10 11.25l7.5-4.583" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
                <input id="email" name="email" type="email" autocomplete="username"
                  [(ngModel)]="email"
                  [placeholder]="emailPlaceholder()"
                  required autofocus />
              </div>
            </div>

            <div class="field">
              <div class="field-row">
                <label for="password">Mot de passe</label>
                @if (config()?.passwordMode === 'create') {
                  <a routerLink="/mot-de-passe-oublie" class="link-sm">Mot de passe oublié ?</a>
                }
              </div>
              <div class="inp-box">
                <svg class="inp-ico" viewBox="0 0 20 20" fill="none">
                  <rect x="3.333" y="9.167" width="13.333" height="9.167" rx="1.667" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M6.667 9.167V6.667a3.333 3.333 0 1 1 6.666 0v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
                <input id="password" name="password" [type]="showPwd() ? 'text' : 'password'"
                  autocomplete="current-password" [(ngModel)]="password"
                  placeholder="••••••••••" required />
                <button type="button" class="eye" (click)="showPwd.set(!showPwd())"
                  [attr.aria-label]="showPwd() ? 'Masquer' : 'Afficher'">
                  <app-icon [name]="showPwd() ? 'eyeOff' : 'eye'" />
                </button>
              </div>
            </div>

            @if (error()) {
              <div class="err-box" role="alert">
                <svg viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M10 6.667v3.666M10 13.333h.008" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                </svg>
                {{ error() }}
              </div>
            }

            <button class="btn-login" type="submit" [disabled]="busy()">
              @if (busy()) {
                <span class="spin"></span> Connexion…
              } @else {
                Se connecter
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="M4.167 10h11.666M10.833 5.833 15 10l-4.167 4.167" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              }
            </button>

          </form>

          <p class="login-hint">
            Pas encore de compte ? Contactez la DSID pour recevoir un lien d'invitation.
          </p>
        </div>

      } @else {

        <div class="login-wrap">
          <div class="login-head">
            <div class="mfa-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>
              </svg>
            </div>
            <h1>Double vérification</h1>
            <p>Un code à 6 chiffres a été envoyé à<br><strong>{{ sentTo() }}</strong></p>
          </div>

          <form class="login-form" (ngSubmit)="verify()" novalidate>
            <div class="field">
              <label for="code" class="code-label">Entrez le code reçu</label>
              <input id="code" name="code" class="code-inp" inputmode="numeric"
                autocomplete="one-time-code" maxlength="6"
                [(ngModel)]="code" placeholder="· · · · · ·" required autofocus />
              <p class="code-hint">Valable 10 minutes · 5 essais maximum</p>
            </div>

            @if (error()) {
              <div class="err-box" role="alert">
                <svg viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M10 6.667v3.666M10 13.333h.008" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                </svg>
                {{ error() }}
              </div>
            }

            <button class="btn-login" type="submit" [disabled]="busy() || code.length !== 6">
              @if (busy()) {
                <span class="spin"></span> Vérification…
              } @else {
                Valider le code
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="M4.167 10h11.666M10.833 5.833 15 10l-4.167 4.167" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              }
            </button>

            <button class="btn-back" type="button" (click)="back()">
              <svg viewBox="0 0 20 20" fill="none">
                <path d="M15.833 10H4.167M9.167 5.833 5 10l4.167 4.167" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Revenir
            </button>

          </form>
        </div>

      }
    </app-auth-layout>
  `,
  styles: `
    /* ---------------------------------------------------------------- */
    /*  Conteneur                                                         */
    /* ---------------------------------------------------------------- */
    .login-wrap {
      display: flex;
      flex-direction: column;
      gap: 28px;
      width: 100%;
    }

    /* ---------------------------------------------------------------- */
    /*  En-tête                                                           */
    /* ---------------------------------------------------------------- */
    .login-head { display: flex; flex-direction: column; gap: 8px; }
    .login-head h1 {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -.03em;
      color: var(--ink);
      margin: 0;
    }
    .login-head p {
      font-size: 14px;
      color: var(--muted);
      margin: 0;
      line-height: 1.5;
    }
    .login-head strong { color: var(--ink); }

    /* Badge MFA */
    .mfa-badge {
      width: 52px; height: 52px;
      border-radius: 16px;
      background: linear-gradient(135deg, #2b0f86, #6a4fe0);
      display: flex; align-items: center; justify-content: center;
      color: #fff;
      margin-bottom: 4px;
    }
    .mfa-badge svg { width: 24px; height: 24px; }

    /* ---------------------------------------------------------------- */
    /*  Formulaire                                                        */
    /* ---------------------------------------------------------------- */
    .login-form { display: flex; flex-direction: column; gap: 16px; }

    .field { display: flex; flex-direction: column; gap: 7px; }
    .field label, .code-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--ink);
    }
    .field-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .link-sm {
      font-size: 12.5px;
      color: var(--blue);
      font-weight: 500;
      text-decoration: none;
    }
    .link-sm:hover { text-decoration: underline; }

    /* Champ avec icône */
    .inp-box { position: relative; }
    .inp-ico {
      position: absolute;
      left: 15px;
      top: 50%; transform: translateY(-50%);
      width: 16px; height: 16px;
      color: var(--faint);
      pointer-events: none;
    }
    .inp-box input {
      width: 100%;
      height: 50px;
      padding: 0 50px 0 44px;
      border-radius: 14px;
      border: 1.5px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      font-size: 14px;
      outline: none;
      transition: border-color .15s, box-shadow .15s, background .15s;
    }
    .inp-box input::placeholder { color: var(--faint); }
    .inp-box input:focus {
      border-color: var(--blue);
      background: var(--shell);
      box-shadow: 0 0 0 4px rgba(43,15,134,.08);
    }

    /* Œil */
    .eye {
      position: absolute;
      right: 8px; top: 50%; transform: translateY(-50%);
      width: 36px; height: 36px;
      border-radius: 10px;
      border: none; background: transparent;
      display: flex; align-items: center; justify-content: center;
      color: var(--faint); cursor: pointer;
      transition: color .15s, background .15s;
    }
    .eye:hover { color: var(--ink); background: var(--line); }
    .eye svg { width: 18px; height: 18px; }

    /* Champ code OTP */
    .code-inp {
      width: 100%;
      height: 68px;
      border-radius: 16px;
      border: 1.5px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 18px;
      text-align: center;
      outline: none;
      transition: border-color .15s, box-shadow .15s;
      padding: 0 18px;
    }
    .code-inp::placeholder {
      letter-spacing: 10px;
      font-size: 22px;
      font-weight: 400;
      color: var(--faint);
    }
    .code-inp:focus {
      border-color: var(--blue);
      box-shadow: 0 0 0 4px rgba(43,15,134,.08);
    }
    .code-hint { font-size: 12px; color: var(--faint); margin: 0; }

    /* Erreur */
    .err-box {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--red-soft);
      color: var(--red);
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
    }
    .err-box svg { width: 16px; height: 16px; flex: none; }

    /* ---------------------------------------------------------------- */
    /*  Boutons                                                           */
    /* ---------------------------------------------------------------- */
    .btn-login {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      height: 52px;
      border-radius: 14px;
      border: none;
      background: linear-gradient(135deg, #2b0f86 0%, #5b21b6 100%);
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity .15s, transform .1s, box-shadow .15s;
      box-shadow: 0 4px 20px rgba(43,15,134,.3), 0 1px 3px rgba(43,15,134,.2);
      letter-spacing: -.01em;
    }
    .btn-login:hover:not(:disabled) {
      opacity: .92;
      transform: translateY(-1px);
      box-shadow: 0 8px 28px rgba(43,15,134,.4);
    }
    .btn-login:active:not(:disabled) { transform: translateY(0); }
    .btn-login:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
    .btn-login svg { width: 18px; height: 18px; }

    .btn-back {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      height: 44px;
      border-radius: 12px;
      border: 1.5px solid var(--line);
      background: transparent;
      color: var(--muted);
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      transition: color .15s, border-color .15s;
    }
    .btn-back:hover { color: var(--ink); border-color: var(--muted); }
    .btn-back svg { width: 16px; height: 16px; }

    /* Note */
    .login-hint {
      text-align: center;
      font-size: 12.5px;
      color: var(--faint);
      line-height: 1.5;
      margin: 0;
    }

    /* Spinner */
    .spin {
      width: 17px; height: 17px;
      border-radius: 50%;
      border: 2.5px solid rgba(255,255,255,.3);
      border-top-color: #fff;
      animation: spin .65s linear infinite;
      flex: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export class LoginPage implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  readonly retour = input<string>();

  protected readonly config = signal<AuthConfig | null>(null);
  protected readonly step = signal<'credentials' | 'code'>('credentials');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly showPwd = signal(false);
  protected readonly sentTo = signal('');
  protected email = '';
  protected password = '';
  protected code = '';
  private challengeId = '';

  protected emailPlaceholder() {
    const d = this.config()?.mailDomains?.[0];
    return d && d !== '*' ? `prenom.nom@${d}` : 'votre@email.com';
  }

  async ngOnInit() {
    this.config.set(await this.auth.loadConfig().catch(() => null));
  }

  async submit() {
    this.error.set('');
    if (!this.email.trim() || !this.password) {
      this.error.set('Veuillez saisir votre adresse e-mail et votre mot de passe.');
      return;
    }
    this.busy.set(true);
    try {
      const r = await this.auth.login(this.email.trim(), this.password);
      if ('mfaRequired' in r) {
        this.challengeId = r.challengeId;
        this.sentTo.set(r.sentTo);
        this.code = '';
        this.step.set('code');
      } else {
        await this.go();
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async verify() {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.verify(this.challengeId, this.code.trim());
      await this.go();
    } catch (e) {
      this.error.set(errorMessage(e));
      const body = (e as { body?: { restart?: boolean } }).body;
      if (body?.restart) setTimeout(() => this.back(), 1500);
    } finally {
      this.busy.set(false);
    }
  }

  back() {
    this.step.set('credentials');
    this.password = '';
    this.error.set('');
  }

  private go() {
    const r = this.retour();
    const safe = r && r.startsWith('/') && !r.startsWith('//') ? r : '/accueil';
    return this.router.navigateByUrl(safe);
  }
}
