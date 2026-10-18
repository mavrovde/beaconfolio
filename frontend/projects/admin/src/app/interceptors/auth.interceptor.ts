import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();

  // Clone request and add authorization header if token exists AND not logging in
  if (token && !req.url.includes(`${environment.apiPrefix}/auth/login`)) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return next(req).pipe(
    catchError((error) => {
      // Handle 401 Unauthorized or 403 Forbidden
      if ((error.status === 401 || error.status === 403) && !req.url.includes(`${environment.apiPrefix}/auth/login`)) {
        authService.logout();
        void router.navigate(['/login']);
      }

      // Handle 403 Forbidden
      if (error.status === 403) {
        console.error('Access denied: insufficient permissions');
      }

      return throwError(() => error);
    }),
  );
};
