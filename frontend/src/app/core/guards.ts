import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

/** Pages réservées aux collaborateurs connectés. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (auth.user()) return true;
  return router.createUrlTree(['/connexion'], { queryParams: { retour: state.url } });
};

/** Écran d'administration. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ensureLoaded();
  return auth.isAdmin() ? true : router.createUrlTree(['/accueil']);
};

/** Page de connexion : inutile si déjà connecté. */
export const anonymousGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ensureLoaded();
  return auth.user() ? router.createUrlTree(['/accueil']) : true;
};
