import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();

    // Use fake timers to handle setTimeout in constructor
    vi.useFakeTimers();

    // Mock localStorage
    const mockLocalStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      language: '',
      length: 0,
      key: vi.fn(),
    };

    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });

    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });

    // We don't inject service here to allow initialization tests to control the environment
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (httpMock) {
      httpMock.verify();
    }
  });

  it('should be created', () => {
    service = TestBed.inject(AuthService);
    expect(service).toBeTruthy();
  });

  describe('login', () => {
    it('should call api/auth/login and store token on success', () => {
      const mockResponse = {
        access_token: 'fake-token',
        token_type: 'bearer',
        expires_in: 3600,
      };

      // Mock setUser logic which happens after login
      const mockUser = { id: 1, username: 'user', email: 'u@test.com', is_admin: true };

      service = TestBed.inject(AuthService);
      service.login('test', 'pass').subscribe((res) => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/login`);
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);

      const meReq = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/me`);
      meReq.flush(mockUser);

      expect(window.localStorage.setItem).toHaveBeenCalledWith('auth_token', 'fake-token');
    });
  });

  describe('logout', () => {
    it('should remove token and clear current user', () => {
      service = TestBed.inject(AuthService);
      service.logout();
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('auth_token');
      expect(service.getCurrentUser()).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('should call api/auth/password with PUT method', () => {
      service = TestBed.inject(AuthService);
      const oldPwd = 'old';
      const newPwd = 'new';

      service.changePassword(oldPwd, newPwd).subscribe();

      const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/password`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ old_password: oldPwd, new_password: newPwd });
      req.flush(null);
    });
  });

  describe('initialization', () => {
    it('should load user if token exists', () => {
      (window.localStorage.getItem as any).mockReturnValue('existing-token');

      const newService = TestBed.inject(AuthService);
      vi.runAllTimers(); // Trigger setTimeout

      const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/me`);
      req.flush({ id: 1, username: 'loaded', email: 'l@test.com', is_admin: false });

      expect(newService.getCurrentUser()?.username).toBe('loaded');
    });

    it('should logout if loading user fails with 401', () => {
      (window.localStorage.getItem as any).mockReturnValue('bad-token');

      const spyLogout = vi.spyOn(AuthService.prototype, 'logout');
      TestBed.inject(AuthService);
      vi.runAllTimers();

      const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/me`);
      req.flush('Error', { status: 401, statusText: 'Unauthorized' });

      expect(spyLogout).toHaveBeenCalled();
    });

    it('should logout if loading user fails with 403', () => {
      (window.localStorage.getItem as any).mockReturnValue('bad-token');

      const spyLogout = vi.spyOn(AuthService.prototype, 'logout');
      TestBed.inject(AuthService);
      vi.runAllTimers();

      const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/me`);
      req.flush('Error', { status: 403, statusText: 'Forbidden' });

      expect(spyLogout).toHaveBeenCalled();
    });

    it('should not logout if loading user fails with 500', () => {
      (window.localStorage.getItem as any).mockReturnValue('some-token');

      const spyLogout = vi.spyOn(AuthService.prototype, 'logout');
      TestBed.inject(AuthService);
      vi.runAllTimers();

      const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/me`);
      req.flush('Error', { status: 500, statusText: 'Server Error' });

      expect(spyLogout).not.toHaveBeenCalled();
    });
  });

  describe('updateGeminiKey', () => {
    it('should call api/auth/gemini-key with PUT method and update current user', () => {
      service = TestBed.inject(AuthService);
      const mockUser = { id: 1, username: 'test', email: 't@t.com', is_admin: true, has_gemini_key: true };
      
      service.updateGeminiKey('new-key').subscribe(user => {
        expect(user).toEqual(mockUser as any);
        expect(service.getCurrentUser()).toEqual(mockUser as any);
      });

      const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/gemini-key`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ api_key: 'new-key' });
      req.flush(mockUser);
    });
  });

  describe('helpers', () => {
    it('isAuthenticated should return true if token exists', () => {
      (window.localStorage.getItem as any).mockReturnValue('token');
      service = TestBed.inject(AuthService);
      vi.runAllTimers();

      // Handle constructor request
      const req = httpMock.expectOne(`${environment.apiUrl}${environment.apiPrefix}/auth/me`);
      req.flush({ id: 1, username: 'test', email: 't@t.com', is_admin: false });

      expect(service.isAuthenticated()).toBe(true);
    });

    it('isAuthenticated should return false if token missing', () => {
      (window.localStorage.getItem as any).mockReturnValue(null);
      service = TestBed.inject(AuthService);
      expect(service.isAuthenticated()).toBe(false);
    });

    it('isAdmin should return true if user is admin', () => {
      // Manually set internal state since it's private but accessible via next() in our test theory if exposed,
      // or effectively by loading user.
      // Easier way: mock the subject or trigger a load.
      // Let's rely on the public observable behavior or "any" cast if needed, but cleaner to trigger load.

      // Simulating logged in state
      const mockUser = { id: 1, username: 'admin', email: 'admin@test.com', is_admin: true };

      // We can simulate a successful login to set the state
      service['currentUserSubject'].next(mockUser);

      expect(service.isAdmin()).toBe(true);
    });

    it('isAdmin should return false if user is not admin or null', () => {
      service['currentUserSubject'].next(null);
      expect(service.isAdmin()).toBe(false);

      service['currentUserSubject'].next({
        id: 2,
        username: 'user',
        email: 'u@test.com',
        is_admin: false,
      });
      expect(service.isAdmin()).toBe(false);
    });

    it('should gracefully skip browser-only functions during SSR', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AuthService,
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: PLATFORM_ID, useValue: 'server' }
        ]
      });
      const serverService = TestBed.inject(AuthService);
      
      expect(serverService.getToken()).toBeNull();
      
      serverService['setToken']('dummy');
      serverService['removeToken']();
      expect(window.localStorage.setItem).not.toHaveBeenCalledWith('auth_token', 'dummy');
    });
  });
});
