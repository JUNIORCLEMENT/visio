import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthLayout } from '../../shared/auth-layout';

@Component({
  selector: 'app-forgot-page',
  imports: [FormsModule, RouterLink, AuthLayout],
  template: `
    <app-auth-layout>
      <form class="stack form" (ngSubmit)="submit()" novalidate>
        <div>
          <h1>Mot de passe oublié</h1>
          <p class="sub">Indiquez votre adresse HPO Mail : un lien pour choisir un nouveau mot de passe vous sera envoyé.</p>
        </div>
        @if (sent()) {
          <div class="alert">Si un compte HPO Visio existe pour cette adresse, un e-mail vient de partir. Pensez à vérifier votre boîte HPO Mail.</div>
        } @else {
          <div class="field">
            <label for="email">Adresse HPO Mail</label>
            <input id="email" name="email" type="email" autocomplete="username" [(ngModel)]="email" required autofocus />
          </div>
          @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
          <button class="btn primary wide" type="submit" [disabled]="busy()">Envoyer le lien</button>
        }
        <a routerLink="/connexion">Revenir à la connexion</a>
      </form>
    </app-auth-layout>
  `,
  styles: `.form { max-width: 420px; width: 100%; }`,
})
export class ForgotPage {
  private readonly api = inject(Api);
  protected email = '';
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal('');

  async submit() {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.api.post('/api/auth/forgot', { email: this.email.trim() });
      this.sent.set(true);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
