import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { filter, map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    void router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  // specific check for admin route
  if (route.data?.['requireAdmin']) {
    return authService.isInitializing$.pipe(
      filter((initializing) => !initializing),
      take(1),
      map(() => {
        const user = authService.getCurrentUser();
        if (user?.is_admin) {
          return true;
        }
        // If we finished initializing and have no admin user, redirect
        void router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
        return false;
      }),
    );
  }

  return true;
};
