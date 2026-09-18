import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { Observable, Subject, firstValueFrom, of } from 'rxjs';

import { SITE_BRAND_SOURCE, SiteBrandService } from './site-brand.service';
import { Brand, DEFAULT_BRAND } from '../theme/brand';
import { provideSharedEnvironment } from '../config/environment.token';

const ENV = {
    production: false,
    apiUrl: 'http://api.test',
    apiPrefix: '/api/app',
    googleAnalyticsId: '',
};
const URL = 'http://api.test/api/app/config/site';

/** A service that must fetch for itself (the admin console's shape). */
function fetching(): SiteBrandService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), provideSharedEnvironment(ENV)],
    });
    return TestBed.inject(SiteBrandService);
}

/** A service handed a stream by its host app (the public app's shape). */
function supplied(source: Observable<Brand>): SiteBrandService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            provideHttpClient(),
            provideHttpClientTesting(),
            provideSharedEnvironment(ENV),
            { provide: SITE_BRAND_SOURCE, useValue: source },
        ],
    });
    return TestBed.inject(SiteBrandService);
}

const http = () => TestBed.inject(HttpTestingController);

describe('SiteBrandService (#67)', () => {
    afterEach(() => {
        http().verify();
    });

    describe('with no source supplied', () => {
        it('reads the PUBLIC site-config endpoint and projects the payload', async () => {
            const svc = fetching();
            const brand = firstValueFrom(svc.brand$);

            const req = http().expectOne(URL);
            expect(req.request.method).toBe('GET');
            req.flush({ site_name: 'Acme', owner_name: 'Ada Lovelace', theme: 'light' });

            await expect(brand).resolves.toMatchObject({
                siteName: 'Acme',
                ownerName: 'Ada Lovelace',
                theme: 'light',
            });
        });

        // Two subscribers, one request: three shared services read this stream,
        // and an extra in-flight request is another thing route extraction can
        // hang on. `expectOne` is the assertion — it fails on a second.
        it('fetches ONCE however many consumers subscribe', async () => {
            const svc = fetching();
            const first = firstValueFrom(svc.brand$);
            const second = firstValueFrom(svc.brand$);

            http().expectOne(URL).flush({ site_name: 'Acme' });

            expect(await first).toEqual(await second);
        });

        it('degrades to the default brand when the request fails', async () => {
            const svc = fetching();
            const brand = firstValueFrom(svc.brand$);
            http().expectOne(URL).flush('nope', { status: 503, statusText: 'Unavailable' });

            await expect(brand).resolves.toEqual(DEFAULT_BRAND);
        });
    });

    describe('with a source supplied by the host app', () => {
        it('uses it and issues NO request of its own', async () => {
            const brand: Brand = { ...DEFAULT_BRAND, siteName: 'Supplied', theme: 'modern' };
            const svc = supplied(of(brand));

            await expect(firstValueFrom(svc.brand$)).resolves.toEqual(brand);
            // `afterEach`'s verify() is what asserts "no request happened".
        });

        // Neither an environment nor an HTTP client is needed on this path;
        // that is the whole reason the two injections live inside `fetch()`.
        // A subject that never emits proves nothing was fetched EAGERLY at
        // construction either.
        it('opens no request before the supplied stream emits', () => {
            const svc = supplied(new Subject<Brand>());
            svc.brand$.subscribe();
            expect(svc.brand$).toBeDefined();
        });
    });
});
