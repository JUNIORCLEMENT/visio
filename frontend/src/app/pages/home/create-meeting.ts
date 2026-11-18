import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { Contact, Meeting } from '../../core/models';
import { Toasts } from '../../core/toast';

@Component({
  selector: 'app-create-meeting',
  imports: [FormsModule],
  template: `
    <div class="overlay" (click)="closed.emit()">
      <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="h-new"
        (click)="$event.stopPropagation()" (ngSubmit)="submit()" novalidate>

        <!-- En-tête -->
        <div class="dialog-head">
          <div class="dialog-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>
            </svg>
          </div>
          <div>
            <h2 id="h-new">Nouvelle réunion</h2>
            <p class="dialog-sub">Planifiez et invitez vos collègues</p>
          </div>
          <button type="button" class="close-btn" (click)="closed.emit()" aria-label="Fermer">
            <svg viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </div>

        <!-- Corps -->
        <div class="dialog-body">

          <!-- Titre -->
          <div class="field">
            <label for="m-title">Titre <span class="req">*</span></label>
            <input id="m-title" name="title" [(ngModel)]="title" maxlength="160"
              placeholder="Ex : Point hebdo — Opérations" required autofocus />
          </div>

          <!-- Maintenant / Planifier -->
          <div class="toggle-row">
            <button type="button" class="toggle-btn" [class.on]="now" (click)="now = true">
              <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              Maintenant
            </button>
            <button type="button" class="toggle-btn" [class.on]="!now" (click)="now = false">
              <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M3 7h14M7 1v3M13 1v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              Planifier
            </button>
          </div>

          @if (!now) {
            <div class="two-cols">
              <div class="field">
                <label for="m-start">Date et heure <span class="req">*</span></label>
                <input id="m-start" name="start" type="datetime-local" [(ngModel)]="start" required />
              </div>
              <div class="field">
                <label for="m-dur">Durée</label>
                <select id="m-dur" name="duration" [(ngModel)]="duration">
                  <option [ngValue]="15">15 minutes</option>
                  <option [ngValue]="30">30 minutes</option>
                  <option [ngValue]="45">45 minutes</option>
                  <option [ngValue]="60">1 heure</option>
                  <option [ngValue]="90">1 h 30</option>
                  <option [ngValue]="120">2 heures</option>
                  <option [ngValue]="180">3 heures</option>
                </select>
              </div>
            </div>
          }

          <!-- Personnes invitées avec autocomplétion -->
          <div class="field">
            <label>Personnes invitées</label>

            <!-- Chips des personnes sélectionnées -->
            @if (selected().length) {
              <div class="chips-row">
                @for (p of selected(); track p.id) {
                  <span class="chip">
                    <span class="chip-av">{{ initials(p.fullName) }}</span>
                    <span class="chip-name">{{ p.fullName }}</span>
                    <button type="button" class="chip-remove" (click)="remove(p)" aria-label="Retirer">
                      <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4 4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                  </span>
                }
              </div>
            }

            <!-- Champ de recherche -->
            <div class="search-box" [class.open]="suggestions().length > 0">
              <svg class="search-ico" viewBox="0 0 20 20" fill="none">
                <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" stroke-width="1.4"/>
                <path d="M15 15l-3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
              <input
                class="search-inp"
                [(ngModel)]="query"
                name="inv-search"
                (ngModelChange)="onSearch($event)"
                (keydown.escape)="closeSuggestions()"
                placeholder="Rechercher un collègue…"
                autocomplete="off" />
              @if (searching()) {
                <span class="search-spin"></span>
              }
            </div>

            <!-- Liste de suggestions -->
            @if (suggestions().length > 0) {
              <div class="suggestions" role="listbox">
                @for (c of suggestions(); track c.id) {
                  <button type="button" class="suggestion-item" role="option"
                    (click)="select(c)">
                    <span class="sug-av">{{ initials(c.fullName) }}</span>
                    <span class="sug-info">
                      <span class="sug-name">{{ c.fullName }}</span>
                      <span class="sug-detail">{{ c.email }}@if (c.department) { · {{ c.department }} }</span>
                    </span>
                    <span class="sug-status" [class.online]="c.online">
                      {{ c.online ? 'En ligne' : '' }}
                    </span>
                  </button>
                }
              </div>
            }

            <span class="field-hint">
              {{ selected().length }} personne{{ selected().length > 1 ? 's' : '' }} invitée{{ selected().length > 1 ? 's' : '' }}
              — chacune recevra une notification et un e-mail.
            </span>
          </div>

          <!-- Ordre du jour -->
          <div class="field">
            <label for="m-desc">Ordre du jour</label>
            <textarea id="m-desc" name="description" [(ngModel)]="description"
              maxlength="2000" rows="3" placeholder="Points à aborder…"></textarea>
          </div>

          <!-- Options -->
          <label class="option-check">
            <input type="checkbox" name="guests" [(ngModel)]="allowGuests" />
            <span class="check-box"></span>
            <span>
              <b>Autoriser les invités externes</b>
              <small>Accès par lien avec salle d'attente</small>
            </span>
          </label>

        </div>

        @if (error()) {
          <div class="dialog-error" role="alert">
            <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4"/><path d="M10 6.5v4M10 13.5h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            {{ error() }}
          </div>
        }

        <!-- Pied -->
        <div class="dialog-foot">
          <button class="btn-cancel" type="button" (click)="closed.emit()">Annuler</button>
          <button class="btn-submit" type="submit" [disabled]="busy()">
            @if (busy()) { <span class="spin"></span> }
            {{ now ? 'Créer et démarrer' : 'Planifier la réunion' }}
          </button>
        </div>

      </form>
    </div>
  `,
  styles: `
    .overlay {
      position: fixed; inset: 0; z-index: 60;
      background: rgba(10,6,30,.5); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    .dialog {
      background: #fff; border-radius: 24px;
      width: min(600px, 100%); max-height: calc(100vh - 32px);
      overflow-y: auto;
      box-shadow: 0 32px 80px rgba(0,0,0,.2);
      display: flex; flex-direction: column;
    }

    /* En-tête */
    .dialog-head { display: flex; align-items: center; gap: 14px; padding: 24px 24px 0; }
    .dialog-icon {
      width: 44px; height: 44px; border-radius: 14px;
      background: #EBF0FF; color: #2B0F86; flex: none;
      display: flex; align-items: center; justify-content: center;
    }
    .dialog-icon svg { width: 22px; height: 22px; }
    h2 { font-size: 18px; font-weight: 700; margin: 0; color: #16131F; }
    .dialog-sub { font-size: 12.5px; color: #8E889E; margin: 2px 0 0; }
    .close-btn {
      margin-left: auto; flex: none; width: 36px; height: 36px;
      border-radius: 10px; border: none; background: #F0F2F8; color: #625D72;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: background .12s;
    }
    .close-btn:hover { background: #E8EAF0; }
    .close-btn svg { width: 16px; height: 16px; }

    /* Corps */
    .dialog-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }

    .field { display: flex; flex-direction: column; gap: 6px; }
    .field label { font-size: 13px; font-weight: 600; color: #16131F; }
    .req { color: #E5323B; }
    .field input, .field select, .field textarea {
      width: 100%; border-radius: 12px;
      border: 1.5px solid #E8EAF0; background: #F8F9FC;
      color: #16131F; font-size: 14px; outline: none;
      padding: 0 14px; height: 46px;
      transition: border-color .12s, background .12s;
    }
    .field textarea { height: auto; padding: 12px 14px; resize: vertical; }
    .field input:focus, .field select:focus, .field textarea:focus {
      border-color: #2B0F86; background: #fff;
      box-shadow: 0 0 0 3px rgba(43,15,134,.08);
    }
    .field-hint { font-size: 11.5px; color: #8E889E; }

    /* Toggle */
    .toggle-row { display: flex; gap: 8px; background: #F0F2F8; border-radius: 14px; padding: 4px; }
    .toggle-btn {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
      height: 40px; border-radius: 10px; border: none; background: transparent;
      color: #625D72; font-size: 13.5px; font-weight: 500; cursor: pointer;
      transition: background .12s, color .12s;
    }
    .toggle-btn svg { width: 16px; height: 16px; }
    .toggle-btn.on { background: #fff; color: #2B0F86; font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,.08); }

    .two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    /* Chips personnes sélectionnées */
    .chips-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 4px; border-radius: 999px;
      background: #EBF0FF; border: 1px solid #C7D6FF;
    }
    .chip-av {
      width: 24px; height: 24px; border-radius: 50%;
      background: #2B0F86; color: #fff;
      font-size: 10px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      flex: none;
    }
    .chip-name { font-size: 12.5px; font-weight: 600; color: #2B0F86; }
    .chip-remove {
      width: 18px; height: 18px; border-radius: 50%; border: none;
      background: rgba(43,15,134,.12); color: #2B0F86;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; padding: 0; flex: none;
    }
    .chip-remove svg { width: 10px; height: 10px; }

    /* Champ recherche */
    .search-box {
      position: relative; display: flex; align-items: center;
    }
    .search-ico {
      position: absolute; left: 12px;
      width: 15px; height: 15px; color: #8E889E; pointer-events: none;
    }
    .search-inp {
      width: 100%; height: 46px; padding: 0 40px 0 36px;
      border-radius: 12px; border: 1.5px solid #E8EAF0;
      background: #F8F9FC; color: #16131F; font-size: 14px; outline: none;
      transition: border-color .12s, background .12s;
    }
    .search-inp:focus { border-color: #2B0F86; background: #fff; box-shadow: 0 0 0 3px rgba(43,15,134,.08); }
    .search-box.open .search-inp { border-radius: 12px 12px 0 0; border-bottom-color: transparent; }
    .search-spin {
      position: absolute; right: 12px;
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid #E8EAF0; border-top-color: #2B0F86;
      animation: spin .65s linear infinite;
    }

    /* Suggestions */
    .suggestions {
      border: 1.5px solid #2B0F86; border-top: none;
      border-radius: 0 0 12px 12px;
      background: #fff;
      max-height: 220px; overflow-y: auto;
      display: flex; flex-direction: column;
    }
    .suggestion-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border: none; background: transparent;
      cursor: pointer; text-align: left;
      transition: background .1s;
    }
    .suggestion-item:hover { background: #F5F7FF; }
    .sug-av {
      width: 34px; height: 34px; border-radius: 50%; flex: none;
      background: #EBF0FF; color: #2B0F86;
      font-size: 12px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .sug-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sug-name { font-size: 13.5px; font-weight: 600; color: #16131F; }
    .sug-detail { font-size: 11.5px; color: #8E889E; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sug-status { font-size: 11px; color: #22C55E; font-weight: 600; }

    /* Option invités externes */
    .option-check {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px 14px; border-radius: 12px; border: 1.5px solid #E8EAF0;
      cursor: pointer; transition: border-color .12s;
    }
    .option-check:hover { border-color: #2B0F86; }
    .option-check input { display: none; }
    .check-box {
      width: 18px; height: 18px; border-radius: 6px; flex: none;
      border: 2px solid #D1D5E8; background: #fff; margin-top: 1px;
      transition: background .12s, border-color .12s;
    }
    .option-check input:checked ~ .check-box {
      background: #2B0F86; border-color: #2B0F86;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 6l3 3 5-5' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-size: 12px; background-repeat: no-repeat; background-position: center;
    }
    .option-check span { display: flex; flex-direction: column; gap: 1px; }
    .option-check b { font-size: 13.5px; font-weight: 600; color: #16131F; }
    .option-check small { font-size: 12px; color: #8E889E; }

    /* Erreur */
    .dialog-error {
      margin: 0 24px; display: flex; align-items: center; gap: 10px;
      padding: 11px 14px; border-radius: 12px;
      background: #FDE8E9; color: #E5323B;
      font-size: 13px; font-weight: 500;
    }
    .dialog-error svg { width: 16px; height: 16px; flex: none; }

    /* Pied */
    .dialog-foot { padding: 16px 24px 24px; display: flex; justify-content: flex-end; gap: 10px; }
    .btn-cancel {
      height: 44px; padding: 0 20px; border-radius: 12px;
      border: 1.5px solid #E8EAF0; background: #fff; color: #625D72;
      font-size: 14px; font-weight: 500; cursor: pointer;
    }
    .btn-cancel:hover { background: #F0F2F8; }
    .btn-submit {
      height: 44px; padding: 0 24px; border-radius: 12px; border: none;
      background: #2B0F86; color: #fff; font-size: 14px; font-weight: 600;
      cursor: pointer; display: flex; align-items: center; gap: 10px;
      box-shadow: 0 4px 14px rgba(43,15,134,.25); transition: background .12s;
    }
    .btn-submit:hover:not(:disabled) { background: #1a0657; }
    .btn-submit:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }

    .spin {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2.5px solid rgba(255,255,255,.3); border-top-color: #fff;
      animation: spin .65s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 480px) { .two-cols { grid-template-columns: 1fr; } }
  `,
})
export class CreateMeetingDialog {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  readonly closed = output<void>();
  readonly created = output<Meeting>();

  protected title = '';
  protected now = true;
  protected start = '';
  protected duration = 60;
  protected description = '';
  protected allowGuests = true;
  protected query = '';
  protected readonly selected = signal<Contact[]>([]);
  protected readonly suggestions = signal<Contact[]>([]);
  protected readonly searching = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  private searchTimer?: ReturnType<typeof setTimeout>;

  protected initials(name: string) {
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  protected onSearch(val: string) {
    clearTimeout(this.searchTimer);
    if (!val.trim()) { this.suggestions.set([]); return; }
    this.searching.set(true);
    this.searchTimer = setTimeout(async () => {
      try {
        const r = await this.api.get<{ contacts: Contact[] }>(
          `/api/contacts?search=${encodeURIComponent(val)}`
        );
        // Exclure les déjà sélectionnés
        const selIds = new Set(this.selected().map(s => s.id));
        this.suggestions.set(r.contacts.filter(c => !selIds.has(c.id)));
      } catch {
        this.suggestions.set([]);
      } finally {
        this.searching.set(false);
      }
    }, 250);
  }

  protected select(c: Contact) {
    this.selected.update(s => [...s, c]);
    this.suggestions.set([]);
    this.query = '';
  }

  protected remove(c: Contact) {
    this.selected.update(s => s.filter(x => x.id !== c.id));
  }

  protected closeSuggestions() {
    this.suggestions.set([]);
  }

  async submit() {
    this.error.set('');
    if (!this.title.trim()) { this.error.set('Donnez un titre à la réunion.'); return; }
    if (!this.now && !this.start) { this.error.set('Choisissez la date et l\'heure.'); return; }

    let scheduledStart: string | null = null;
    if (!this.now) {
      const d = new Date(this.start);
      if (Number.isNaN(d.getTime())) { this.error.set('Date invalide.'); return; }
      scheduledStart = d.toISOString();
    }

    this.busy.set(true);
    try {
      const r = await this.api.post<{ meeting: Meeting; notFound: string[] }>('/api/meetings', {
        title: this.title.trim(),
        description: this.description.trim() || null,
        scheduledStart,
        durationMinutes: this.now ? null : this.duration,
        allowGuests: this.allowGuests,
        inviteeEmails: this.selected().map(c => c.email),
      });
      if (r.notFound.length) {
        this.toasts.show(`Non trouvés : ${r.notFound.join(', ')}`, 'info', 6000);
      }
      this.created.emit(r.meeting);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
