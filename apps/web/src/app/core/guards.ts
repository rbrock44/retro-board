import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const signedIn: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ensureLoaded();
  if (auth.me()) return true;
  return router.createUrlTree(['/login'], { queryParams: state.url !== '/' ? { next: state.url } : {} });
};

export const signedOut: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.ensureLoaded();
  return auth.me() ? inject(Router).createUrlTree(['/']) : true;
};

export const instanceAdmin: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.ensureLoaded();
  return auth.isAdmin() ? true : inject(Router).createUrlTree(['/']);
};
