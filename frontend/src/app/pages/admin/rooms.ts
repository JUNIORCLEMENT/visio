import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api';
import { Meeting } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';

interface RoomForm {
  id: string | null;
  title: string;
  department: string;
  allowGuests: boolean;
  recordingAllowed: boolean;
}

@Component({
  selector: 'app-admin-rooms',
  imports: [FormsModule, Icon],
  template: `
    <section class="card stack">
      <div class="between">
        <div>
          <h2>Salles permanentes</h2>
          <p class="sub">Une salle par service, toujours disponible avec le même code.</p>
        </div>
        <button class="btn primary" type="button" (click)="edit(null)"><app-icon name="plus" /> Créer une salle</button>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Salle</th>
              <th>Service</th>
              <th>Code</th>
              <th>Invités externes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rooms(); track r.id) {
              <tr>
                <td><b>{{ r.title }}</b>@if (r.participants) { <span class="pill live">{{ r.participants }} en ligne</span> }</td>
                <td>{{ r.department ?? '—' }}</td>
                <td class="mono">{{ r.code }}</td>
                <td><span class="pill" [class.ok]="r.allowGuests" [class.off]="!r.allowGuests">{{ r.allowGuests ? 'Autorisés' : 'Interdits' }}</span></td>
                <td><button class="mini" type="button" (click)="edit(r)">Modifier</button></td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="empty">Aucune salle permanente.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (form(); as f) {
      <div class="overlay" (click)="form.set(null)">
        <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="h-room"
          (click)="$event.stopPropagation()" (ngSubmit)="save(f)" novalidate>
          <h2 id="h-room">{{ f.id ? 'Modifier la salle' : 'Nouvelle salle permanente' }}</h2>
          <div class="field">
            <label for="r-title">Nom de la salle</label>
            <input id="r-title" name="title" [(ngModel)]="f.title" maxlength="160" required />
          </div>
          <div class="field">
            <label for="r-dep">Service</label>
            <input id="r-dep" name="dep" [(ngModel)]="f.department" maxlength="160" />
          </div>
          <label class="check">
            <input type="checkbox" name="guests" [(ngModel)]="f.allowGuests" />
            Autoriser les invités externes
          </label>
          <p class="hint">Les réunions de cette salle sont enregistrées automatiquement (règle générale, onglet Sécurité).</p>
          @if (error()) { <div class="alert error" role="alert">{{ error() }}</div> }
          <div class="dialog-foot">
            <button class="btn ghost" type="button" (click)="form.set(null)">Annuler</button>
            <button class="btn primary" type="submit" [disabled]="busy()">Enregistrer</button>
          </div>
        </form>
      </div>
    }
  `,
})
export class AdminRooms implements OnInit {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly rooms = signal<Meeting[]>([]);
  protected readonly form = signal<RoomForm | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  ngOnInit() { this.load(); }

  async load() {
    try {
      const r = await this.api.get<{ rooms: Meeting[] }>('/api/admin/rooms');
      this.rooms.set(r.rooms);
    } catch (e) {
      this.toasts.error(errorMessage(e));
    }
  }

  edit(r: Meeting | null) {
    this.error.set('');
    this.form.set({
      id: r?.id ?? null,
      title: r?.title ?? '',
      department: r?.department ?? '',
      allowGuests: r?.allowGuests ?? true,
      recordingAllowed: r?.recordingAllowed ?? false,
    });
  }

  async save(f: RoomForm) {
    this.error.set('');
    if (!f.title.trim()) { this.error.set('Donnez un nom à la salle.'); return; }
    const body = {
      title: f.title.trim(),
      department: f.department.trim() || null,
      allowGuests: f.allowGuests,
      recordingAllowed: f.recordingAllowed,
    };
    this.busy.set(true);
    try {
      if (f.id) await this.api.patch(`/api/admin/rooms/${f.id}`, body);
      else await this.api.post('/api/admin/rooms', body);
      this.toasts.show(f.id ? 'Salle modifiée.' : 'Salle créée.');
      this.form.set(null);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
