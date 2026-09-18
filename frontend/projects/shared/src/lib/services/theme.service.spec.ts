import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Observable, Subject, throwError } from 'rxjs';

import { ThemeService } from './theme.service';
import { THEME_PRESETS } from '../theme/theme-presets';
import { provideSharedEnvironment } from '../config/environment.token';

/** The attribute as it currently stands on the root element. */
const stamped = () => document.documentElement.getAttribute('data-theme');

const ENV = {
    production: false,
    apiUrl: 'http://api.test',
    apiPrefix: '/api/app',
    googleAnalyticsId: '',
};

function service(): ThemeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            provideHttpClient(),
            provideHttpClientTesting(),
            provideSharedEnvironment(ENV),
            // The real DOCUMENT: this service's entire job is to mutate the
            // root element, and a stub would test the stub.
            { provide: DOCUMENT, useValue: document },
        ],
    });
    return TestBed.inject(ThemeService);
}

describe('ThemeService (#339, shared by both apps since #67)', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('data-theme');
    });

    afterEach(() => {
        TestBed.inject(HttpTestingController).verify();
    });

    it.each(THEME_PRESETS.map((p) => [p]))('stamps the %s preset verbatim', (preset) => {
        service().apply(preset);
        expect(stamped()).toBe(preset);
    });

    // A name no `[data-theme="..."]` block matches would leave the page on
    // whatever `:root` holds — half-themed, which is worse than the default.
    it.each([['neon-vaporwave'], [''], [undefined]])(
        'normalizes the unknown value %s to the default preset',
        (value) => {
            service().apply(value as string | undefined);
            expect(stamped()).toBe('terminal');
        },
    );

    describe('with a theme stream supplied by the host app (the public app)', () => {
        // The eager stamp is the point: a visitor whose config request is
        // still in flight must never see an element with NO `data-theme`.
        it('stamps the default synchronously, before the config arrives', () => {
            const theme$ = new Subject<string | undefined>();
            service().initialize(theme$);
            expect(stamped()).toBe('terminal');

            theme$.next('light');
            expect(stamped()).toBe('light');
        });

        it('upgrades to the configured preset when the config lands', () => {
            const theme$ = new Subject<string | undefined>();
            service().initialize(theme$);
            theme$.next('modern');
            expect(stamped()).toBe('modern');
        });

        // The public app's config service already degrades an unreachable
        // backend, so this arm only fires if that contract is ever broken. It
        // exists because a theme must not be able to take an app down.
        it('falls back to the default when the supplied stream errors', () => {
            service().initialize(throwError(() => new Error('boom')));
            expect(stamped()).toBe('terminal');
        });

        // A supplied stream must mean NO request of the service's own —
        // otherwise the public app pays twice for one field, and the extra
        // in-flight request is another thing that can hang route extraction.
        it('issues no HTTP request of its own', () => {
            service().initialize(new Subject<string | undefined>());
            // `afterEach`'s verify() is the assertion; this documents it.
            expect(stamped()).toBe('terminal');
        });
    });

    describe('with no stream supplied (the admin app)', () => {
        it('reads the PUBLIC site-config endpoint and stamps what it returns', () => {
            const svc = service();
            svc.initialize();
            expect(stamped()).toBe('terminal');

            const req = TestBed.inject(HttpTestingController).expectOne(
                'http://api.test/api/app/config/site',
            );
            expect(req.request.method).toBe('GET');
            req.flush({ theme: 'classic' });
            expect(stamped()).toBe('classic');
        });

        // The admin login screen is rendered before anyone authenticates, so
        // an unreachable or 401-ing endpoint must degrade, not throw.
        it('keeps the default when that request fails', () => {
            service().initialize();
            TestBed.inject(HttpTestingController)
                .expectOne('http://api.test/api/app/config/site')
                .flush('nope', { status: 500, statusText: 'Server Error' });
            expect(stamped()).toBe('terminal');
        });

        it('keeps the default when the response carries no theme', () => {
            service().initialize();
            TestBed.inject(HttpTestingController)
                .expectOne('http://api.test/api/app/config/site')
                .flush({});
            expect(stamped()).toBe('terminal');
        });

        it('normalizes an unknown theme from the wire', () => {
            service().initialize();
            TestBed.inject(HttpTestingController)
                .expectOne('http://api.test/api/app/config/site')
                .flush({ theme: 'neon-vaporwave' });
            expect(stamped()).toBe('terminal');
        });
    });

    it('accepts a plain Observable source', () => {
        service().initialize(new Observable<string>((s) => s.next('dark')));
        expect(stamped()).toBe('dark');
    });
});
