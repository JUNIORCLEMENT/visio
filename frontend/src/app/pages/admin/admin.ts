import { Component, OnInit, input, signal } from '@angular/core';
import { AdminDashboard } from './dashboard';
import { AdminLogs } from './logs';
import { AdminRecordings } from './recordings';
import { AdminRooms } from './rooms';
import { AdminSecurity } from './security';
import { AdminUsers } from './users';

type Tab = 'dash' | 'users' | 'rooms' | 'rec' | 'sec' | 'logs';

@Component({
  selector: 'app-admin-page',
  imports: [AdminDashboard, AdminUsers, AdminRooms, AdminRecordings, AdminSecurity, AdminLogs],
  template: `
    <section class="card between">
      <div>
        <div class="row"><h1>Administration</h1><span class="pill ok">Admin</span></div>
        <p class="sub">Pilotage de la plateforme HPO Visio</p>
      </div>
      <div class="tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [class.on]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
        }
      </div>
    </section>
    @switch (tab()) {
      @case ('dash') { <app-admin-dashboard /> }
      @case ('users') { <app-admin-users /> }
      @case ('rooms') { <app-admin-rooms /> }
      @case ('rec') { <app-admin-recordings /> }
      @case ('sec') { <app-admin-security /> }
      @case ('logs') { <app-admin-logs /> }
    }
  `,
  styles: `:host { display: flex; flex-direction: column; gap: 16px; }`,
})
export class AdminPage implements OnInit {
  /** ?onglet=enregistrements ouvre directement un onglet */
  readonly onglet = input<string>();
  protected readonly tab = signal<Tab>('dash');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'dash', label: 'Tableau de bord' },
    { id: 'users', label: 'Utilisateurs' },
    { id: 'rooms', label: 'Réunions' },
    { id: 'rec', label: 'Enregistrements' },
    { id: 'sec', label: 'Sécurité' },
    { id: 'logs', label: 'Journaux' },
  ];

  ngOnInit() {
    const map: Record<string, Tab> = { enregistrements: 'rec', utilisateurs: 'users', reunions: 'rooms', securite: 'sec', journaux: 'logs' };
    const t = map[this.onglet() ?? ''];
    if (t) this.tab.set(t);
  }
}
