import { Routes } from '@angular/router';
import { adminGuard, anonymousGuard, authGuard } from './core/guards';
import { Shell } from './layout/shell';

export const routes: Routes = [
  {
    path: 'connexion',
    canActivate: [anonymousGuard],
    title: 'Connexion · HPO Visio',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: 'mot-de-passe-oublie',
    title: 'Mot de passe oublié · HPO Visio',
    loadComponent: () => import('./pages/password/forgot').then((m) => m.ForgotPage),
  },
  {
    path: 'reinitialiser/:token',
    title: 'Nouveau mot de passe · HPO Visio',
    loadComponent: () => import('./pages/password/reset').then((m) => m.ResetPage),
  },
  {
    path: 'invitation/:token',
    title: 'Activer mon compte · HPO Visio',
    loadComponent: () => import('./pages/invitation/invitation').then((m) => m.InvitationPage),
  },
  {
    path: 'rejoindre/:code',
    title: 'Rejoindre une réunion · HPO Visio',
    loadComponent: () => import('./pages/guest/guest').then((m) => m.GuestPage),
  },
  {
    path: 'reunion/:code',
    canActivate: [authGuard],
    title: 'Réunion · HPO Visio',
    loadComponent: () => import('./pages/meeting/meeting').then((m) => m.MeetingPage),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'accueil' },
      {
        path: 'accueil',
        title: 'Accueil · HPO Visio',
        loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
      },
      {
        path: 'calendrier',
        title: 'Calendrier · HPO Visio',
        loadComponent: () => import('./pages/calendar/calendar').then((m) => m.CalendarPage),
      },
      {
        path: 'activite',
        title: 'Activité · HPO Visio',
        loadComponent: () => import('./pages/activity/activity').then((m) => m.ActivityPage),
      },
      {
        path: 'contacts',
        title: 'Contacts · HPO Visio',
        loadComponent: () => import('./pages/contacts/contacts').then((m) => m.ContactsPage),
      },
      {
        path: 'comptes-rendus',
        title: 'Comptes rendus · HPO Visio',
        loadComponent: () => import('./pages/reports/reports').then((m) => m.ReportsPage),
      },
      {
        path: 'comptes-rendus/:id',
        title: 'Compte rendu · HPO Visio',
        loadComponent: () => import('./pages/reports/report').then((m) => m.ReportPage),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        title: 'Administration · HPO Visio',
        loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
