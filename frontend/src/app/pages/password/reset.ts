import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api';
import { AuthLayout } from '../../shared/auth-layout';

@Component({
  selector: 'app-reset-page',
  imports: [FormsModule, RouterLink, AuthLayout],
  template: `
    <app-auth-layout>
      <form class="stack form" (ngSubmit)="submit()" novalidate>
        <div>
          <h1>Nouveau mot de passe</h1>
          <p class="sub">10 caractères minimum, avec au moins une lettre et un chiffre.</p>
        </div>
        @if (done()) {
          <div class="alert">Votre mot de passe a été changé.</div>
          <a class="btn primary wide" routerLink="/connexion">Se connecter</a>
        } @else {
          <div class="field">
            <label for="p1">Nouveau mot de passe</label>
            <input id="p1" name="p1" type="password" autocomplete="new-password" [(ngModel)]="password" required />
          </div>
          <div class="field">
            <label for="p2">Confirmer le mot de passe</label>
            <input id="p2" name="p2" type="password" autocomplete="new-password" [(ngModel)]="confirm" required />
          </div>
          @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
          <button class="btn primary wide" type="submit" [disabled]="busy()">Enregistrer</button>
        }
      </form>
    </app-auth-layout>
  `,
  styles: `.form { max-width: 420px; width: 100%; }`,
})
export class ResetPage {
  private readonly api = inject(Api);
  readonly token = input.required<string>();
  protected password = '';
  protected confirm = '';
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal('');

  async submit() {
    this.error.set('');
    if (this.password !== this.confirm) {
      this.error.set('Les deux mots de passe ne correspondent pas.');
      return;
    }
    this.busy.set(true);
    try {
      await this.api.post('/api/auth/reset', { token: this.token(), password: this.password });
      this.done.set(true);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
