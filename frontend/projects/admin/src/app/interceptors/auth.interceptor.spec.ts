import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';
import { environment } from '../../environments/environment';
import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';

describe('AuthInterceptor', () => {
    let httpMock: HttpTestingController;
    let httpClient: HttpClient;
    let authService: { getToken: Mock, logout: Mock };
    let router: { navigate: Mock };

    beforeEach(() => {
        authService = {
            getToken: vi.fn(),
            logout: vi.fn(),
        };
        router = {
            navigate: vi.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                provideHttpClient(withInterceptors([authInterceptor])),
                provideHttpClientTesting(),
                { provide: AuthService, useValue: authService },
                { provide: Router, useValue: router },
            ],
        });

        httpMock = TestBed.inject(HttpTestingController);
        httpClient = TestBed.inject(HttpClient);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('should add Authorization header when token exists', () => {
        authService.getToken.mockReturnValue('fake-token');

        httpClient.get(environment.apiPrefix + '/data').subscribe();

        const req = httpMock.expectOne(environment.apiPrefix + '/data');
        expect(req.request.headers.has('Authorization')).toBe(true);
        expect(req.request.headers.get('Authorization')).toBe('Bearer fake-token');
        req.flush({});
    });

    it('should NOT add Authorization header when logging in', () => {
        authService.getToken.mockReturnValue('fake-token');

        httpClient.post(environment.apiPrefix + '/auth/login', {}).subscribe();

        const req = httpMock.expectOne(environment.apiPrefix + '/auth/login');
        expect(req.request.headers.has('Authorization')).toBe(false);
        req.flush({});
    });

    it('should NOT add Authorization header when no token', () => {
        authService.getToken.mockReturnValue(null);

        httpClient.get(environment.apiPrefix + '/data').subscribe();

        const req = httpMock.expectOne(environment.apiPrefix + '/data');
        expect(req.request.headers.has('Authorization')).toBe(false);
        req.flush({});
    });

    it('should logout and redirect on 401 response', () => {
        authService.getToken.mockReturnValue('fake-token');

        httpClient.get(environment.apiPrefix + '/data').subscribe({
            next: () => { throw new Error('should have failed with 401'); },
            error: (error) => {
                expect(error.status).toBe(401);
            },
        });

        const req = httpMock.expectOne(environment.apiPrefix + '/data');
        req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

        expect(authService.logout).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('should logout and redirect on 403 response', () => {
        authService.getToken.mockReturnValue('fake-token');

        httpClient.get(environment.apiPrefix + '/data').subscribe({
            next: () => { throw new Error('should have failed with 403'); },
            error: (error) => {
                expect(error.status).toBe(403);
            },
        });

        const req = httpMock.expectOne(environment.apiPrefix + '/data');
        req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

        expect(authService.logout).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('should NOT logout on 401 for login endpoint', () => {
        authService.getToken.mockReturnValue(null);

        httpClient.post(environment.apiPrefix + '/auth/login', {}).subscribe({
            next: () => { throw new Error('should have failed'); },
            error: (error) => expect(error.status).toBe(401),
        });

        const req = httpMock.expectOne(environment.apiPrefix + '/auth/login');
        req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

        expect(authService.logout).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });
});
