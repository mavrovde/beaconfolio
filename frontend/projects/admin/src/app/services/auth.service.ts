import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable, tap, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface User {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  // SECURITY (issue #143): the backend never returns the raw Gemini key — only
  // whether one is configured. The key is write-only via updateGeminiKey().
  has_gemini_key?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);

  private readonly TOKEN_KEY = 'auth_token';
  private readonly apiUrl = environment.apiUrl;

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private isInitializingSubject = new BehaviorSubject<boolean>(true);
  public isInitializing$ = this.isInitializingSubject.asObservable();

  private isBrowser: boolean;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    // Load user on service initialization if token exists
    if (this.isBrowser && this.getToken()) {
      // Defer loading to avoid circular dependency with AuthInterceptor
      setTimeout(() => {
        this.loadCurrentUser();
      }, 0);
    } else {
      this.isInitializingSubject.next(false);
    }
  }

  login(username: string, password: string): Observable<User> {
    const body = new HttpParams().set('username', username).set('password', password);
    const headers = new HttpHeaders().set('Content-Type', 'application/x-www-form-urlencoded');

    return this.http.post<LoginResponse>(`${this.apiUrl}${environment.apiPrefix}/auth/login`, body.toString(), { headers }).pipe(
      // Wait for the user to be loaded before completing the login observable
      switchMap((response) => {
        this.setToken(response.access_token);
        return this.fetchCurrentUser();
      }),
    );
  }

  logout(): void {
    this.removeToken();
    this.currentUserSubject.next(null);
  }

  changePassword(oldPassword: string, newPassword: string): Observable<void> {
    const body = { old_password: oldPassword, new_password: newPassword };
    return this.http.put<void>(`${this.apiUrl}${environment.apiPrefix}/auth/password`, body);
  }

  updateGeminiKey(apiKey: string): Observable<User> {
    return this.http.put<User>(`${this.apiUrl}${environment.apiPrefix}/auth/gemini-key`, { api_key: apiKey }).pipe(
      tap(user => this.currentUserSubject.next(user))
    );
  }

  getToken(): string | null {
    if (!this.isBrowser) return null;
    return localStorage.getItem(this.TOKEN_KEY);
  }

  private setToken(token: string): void {
    if (this.isBrowser) {
      localStorage.setItem(this.TOKEN_KEY, token);
    }
  }

  private removeToken(): void {
    if (this.isBrowser) {
      localStorage.removeItem(this.TOKEN_KEY);
    }
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  isAdmin(): boolean {
    const user = this.currentUserSubject.value;
    return user?.is_admin ?? false;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  private loadCurrentUser(): void {
    this.fetchCurrentUser().subscribe();
  }

  private fetchCurrentUser(): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}${environment.apiPrefix}/auth/me`).pipe(
      tap({
        next: (user) => {
          this.currentUserSubject.next(user);
          this.isInitializingSubject.next(false);
        },
        error: (error) => {
          // Only logout on definitive auth errors
          if (error.status === 401 || error.status === 403) {
            this.logout();
          }
          this.isInitializingSubject.next(false);
        },
      }),
    );
  }
}
