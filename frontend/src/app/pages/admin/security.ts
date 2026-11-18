import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { Settings } from '../../core/models';
import { Toasts } from '../../core/toast';

type BoolKey = 'allow_guests' | 'guest_waiting_room' | 'admin_2fa' | 'external_2fa' | 'recording_allowed';

@Component({
  selector: 'app-admin-security',
  imports: [FormsModule],
  template: `
    <section class="card stack box">
      <div>
        <h2>Règles de sécurité</h2>
        <p class="sub">S’appliquent à toutes les réunions. Chaque modification est enregistrée au journal.</p>
      </div>
      @if (settings(); as s) {
        @for (r of rules; track r.key) {
          <div class="set">
            <div class="grow"><b>{{ r.title }}</b><p class="sub">{{ r.text }}</p></div>
            <button class="switch" type="button" role="switch" [attr.aria-checked]="s[r.key]" [attr.aria-label]="r.title"
              [disabled]="busy()" (click)="toggle(r.key)"></button>
          </div>
        }
        <div class="set">
          <div class="grow"><b>Conservation des enregistrements</b><p class="sub">Suppression automatique ensuite.</p></div>
          <label class="sr-only" for="ret">Durée de conservation</label>
          <select id="ret" class="input sel" [ngModel]="s.recording_retention_days" (ngModelChange)="save({ recording_retention_days: $event })">
            <option [ngValue]="30">30 jours</option>
            <option [ngValue]="90">90 jours</option>
            <option [ngValue]="365">1 an</option>
          </select>
        </div>
        <div class="set">
          <div class="grow"><b>Validité des liens d’invitation</b><p class="sub">Valeur proposée par défaut dans « Inviter des utilisateurs ».</p></div>
          <label class="sr-only" for="ttl">Validité par défaut</label>
          <select id="ttl" class="input sel" [ngModel]="s.invitation_default_ttl" (ngModelChange)="save({ invitation_default_ttl: $event })">
            <option [ngValue]="48">48 heures</option>
            <option [ngValue]="72">72 heures</option>
            <option [ngValue]="168">7 jours</option>
          </select>
        </div>
        <p class="hint">Le code de vérification est envoyé par e-mail sur la boîte HPO Mail. L’enregistrement utilise le service LiveKit Egress (voir README).</p>
      } @else {
        <div class="row"><span class="spin"></span></div>
      }
    </section>
  `,
  styles: `
    .box { max-width: 780px; }
    .set { display: flex; align-items: center; gap: 16px; padding: 14px 0; border-top: 1px solid var(--line); }
    .sel { width: 150px; }
  `,
})
export class AdminSecurity implements OnInit {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly settings = signal<Settings | null>(null);
  protected readonly busy = signal(false);

  protected readonly rules: { key: BoolKey; title: string; text: string }[] = [
    { key: 'allow_guests', title: 'Autoriser les invités externes', text: 'Rejoindre par lien, sans compte.' },
    { key: 'guest_waiting_room', title: 'Salle d’attente obligatoire pour les invités', text: 'L’organisateur admet chaque invité.' },
    { key: 'admin_2fa', title: 'Double authentification pour les administrateurs', text: 'Code à 6 chiffres envoyé sur HPO Mail.' },
    { key: 'external_2fa', title: 'Double authentification depuis l’extérieur', text: 'Pour tous les utilisateurs hors du réseau interne.' },
    { key: 'recording_allowed', title: 'Enregistrer toutes les réunions et tous les appels', text: 'Automatique. Fichiers conservés par la DSID (onglet Enregistrements) ; les participants sont avertis.' },
  ];

  async ngOnInit() {
    try {
      const r = await this.api.get<{ settings: Settings }>('/api/admin/settings');
      this.settings.set(r.settings);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  protected toggle(key: BoolKey) {
    const s = this.settings();
    if (s) this.save({ [key]: !s[key] });
  }

  async save(patch: Partial<Settings>) {
    this.busy.set(true);
    try {
      const r = await this.api.put<{ settings: Settings }>('/api/admin/settings', patch);
      this.settings.set(r.settings);
      this.toasts.show('Règle enregistrée.');
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
