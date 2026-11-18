import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { ROLES, ROLE_LABELS } from '../../core/labels';
import { Role } from '../../core/models';
import { Toasts } from '../../core/toast';

/** « Inviter des utilisateurs » : un lien d'activation est envoyé sur la boîte HPO Mail. */
@Component({
  selector: 'app-invite-dialog',
  imports: [FormsModule],
  template: `
    <div class="overlay" (click)="closed.emit()">
      <div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="h-inv" (click)="$event.stopPropagation()">
        <div class="grid">
          <form class="stack" (ngSubmit)="send()" novalidate>
            <div>
              <h2 id="h-inv">Inviter des utilisateurs</h2>
              <p class="sub">Chaque personne reçoit un lien sur sa boîte HPO Mail. Son compte HPO Visio est créé avec les informations de l’annuaire.</p>
            </div>
            <div class="field">
              <label for="inv-mails">Adresses HPO Mail</label>
              <textarea id="inv-mails" name="emails" [ngModel]="emails()" (ngModelChange)="emails.set($event); error.set('')"
                [placeholder]="'prenom.nom@' + domain() + ', une par ligne ou séparées par des virgules'" autofocus></textarea>
            </div>
            <div class="two">
              <div class="field">
                <label for="inv-role">Rôle</label>
                <select id="inv-role" name="role" [ngModel]="role()" (ngModelChange)="role.set($event)">
                  @for (r of roles; track r) { <option [value]="r">{{ label(r) }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="inv-ttl">Lien valable</label>
                <select id="inv-ttl" name="ttl" [ngModel]="ttl()" (ngModelChange)="ttl.set($event)">
                  <option [ngValue]="48">48 heures</option>
                  <option [ngValue]="72">72 heures</option>
                  <option [ngValue]="168">7 jours</option>
                </select>
              </div>
            </div>
            @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
            <div class="dialog-foot">
              <button class="btn ghost" type="button" (click)="closed.emit()">Annuler</button>
              <button class="btn primary" type="submit" [disabled]="busy()">
                @if (busy()) { <span class="spin" aria-hidden="true"></span> } Envoyer {{ count() > 1 ? 'les ' + count() + ' invitations' : 'l’invitation' }}
              </button>
            </div>
          </form>

          <div class="preview" aria-label="Aperçu de l’e-mail">
            <span class="label">Aperçu de l’e-mail</span>
            <div class="mail">
              <div class="mh"><b>Activez votre compte HPO Visio</b><span>À : {{ firstEmail() }}</span></div>
              <div class="mb">
                <p>Bonjour,</p>
                <p>La DSID vous a ouvert un accès à <b>HPO Visio</b>, l’outil de réunions vidéo du Groupe, avec le rôle <b>{{ label(role()) }}</b>.</p>
                <p>Votre compte sera créé à partir de vos informations HPO Mail. Il vous suffit de confirmer.</p>
                <span class="cta">Activer mon compte</span>
                <p class="hint">Ce lien est personnel et ne fonctionne qu’une fois. Il expire dans {{ ttl() === 168 ? '7 jours' : ttl() + ' heures' }}.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 22px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .preview { display: flex; flex-direction: column; gap: 8px; }
    .mail { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; font-size: 13px; }
    .mh { background: var(--panel); padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; color: var(--muted); }
    .mh b { color: var(--ink); }
    .mb { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .cta { align-self: flex-start; background: var(--blue); color: #fff; border-radius: 999px; padding: 9px 16px; font-weight: 600; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } .preview { display: none; } }
  `,
})
export class InviteDialog implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly toasts = inject(Toasts);
  readonly closed = output<void>();
  readonly sent = output<void>();

  protected readonly roles = ROLES;
  protected readonly emails = signal('');
  protected readonly role = signal<Role>('user');
  protected readonly ttl = signal(72);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly domain = signal('hpo-groupe.com');
  protected readonly list = computed(() => this.emails().split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean));
  protected readonly count = computed(() => this.list().length);
  protected readonly firstEmail = computed(() => this.list()[0] ?? `prenom.nom@${this.domain()}`);
  protected label = (r: Role) => ROLE_LABELS[r];

  async ngOnInit() {
    const c = await this.auth.loadConfig().catch(() => null);
    if (c?.mailDomains[0]) this.domain.set(c.mailDomains[0]);
  }

  async send() {
    this.error.set('');
    if (!this.count()) {
      this.error.set('Saisissez au moins une adresse HPO Mail.');
      return;
    }
    this.busy.set(true);
    try {
      const r = await this.api.post<{ sent: number; results: { email: string; ok: boolean; error?: string }[] }>(
        '/api/admin/invitations',
        { emails: this.list(), role: this.role(), ttlHours: this.ttl() },
      );
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) this.toasts.error(`Échec pour : ${failed.map((f) => `${f.email} (${f.error})`).join(', ')}`);
      if (r.sent) this.toasts.show(r.sent > 1 ? `Invitations envoyées à ${r.sent} personnes.` : `Invitation envoyée à ${r.results[0].email}.`);
      this.sent.emit();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
