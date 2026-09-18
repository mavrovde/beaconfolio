import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { SHARED_ENVIRONMENT, SharedEnvironment } from '../config/environment.token';
import { Brand, BrandDto, DEFAULT_BRAND, normalizeBrand } from '../theme/brand';

/**
 * A brand stream an app ALREADY has, handed to the shared library so it does
 * not fetch the same document twice.
 *
 * The public app fetches `/config/site` for its own `SiteConfigService`; three
 * shared consumers (theme, brand assets, shell chrome) want fields from that
 * same response. Without this seam each of them would issue its own request —
 * and an extra in-flight request is not merely wasteful here: it is another
 * task `ng build`'s route-extraction bootstrap can wait on (see
 * `ThemeService`'s note on the 33 s abort).
 *
 * The admin console has no such stream and provides nothing, so
 * `SiteBrandService` makes ONE narrow request that all three consumers share.
 */
export const SITE_BRAND_SOURCE = new InjectionToken<Observable<Brand>>('SITE_BRAND_SOURCE');

/**
 * The one brand stream inside `@beaconfolio/shared` (#67).
 *
 * Either the host app's (via `SITE_BRAND_SOURCE`) or this service's own
 * `shareReplay(1)` fetch — the consumers cannot tell which, which is the
 * point: `ThemeService`, `BrandAssetsService` and `ShellChromeService` each
 * subscribe freely and the app pays for at most one request either way.
 */
@Injectable({ providedIn: 'root' })
export class SiteBrandService {
    /**
     * Never errors and never completes empty: an unreachable backend degrades
     * to `DEFAULT_BRAND`. A brand may not take an app down.
     */
    readonly brand$: Observable<Brand>;

    constructor() {
        const supplied = inject(SITE_BRAND_SOURCE, { optional: true });
        // `fetch()` — and therefore the `HttpClient` and `SHARED_ENVIRONMENT`
        // injections inside it — happens ONLY when nothing was supplied. Both
        // are still injected from the constructor's injection context, so this
        // is a real injection and not a service-locator lookup; what it buys
        // is that an app (or a TestBed) handing over its own stream need not
        // provide an HTTP client or an environment at all. Injecting them as
        // fields would have required both of every consumer of every template
        // that renders a shell prompt.
        this.brand$ = (supplied ?? this.fetch()).pipe(shareReplay(1));
    }

    /**
     * The PUBLIC site-config endpoint, on purpose: the admin login screen is
     * rendered before anyone has authenticated, so reading brand from the
     * admin-only settings API would leave the one screen a forker sees first
     * unbranded.
     */
    private fetch(): Observable<Brand> {
        const env = inject<SharedEnvironment>(SHARED_ENVIRONMENT);
        const url = `${env.apiUrl}${env.apiPrefix}/config/site`;
        return inject(HttpClient).get<BrandDto>(url).pipe(
            map((dto) => normalizeBrand(dto)),
            catchError(() => of(DEFAULT_BRAND)),
        );
    }
}
