import { StaticProvider } from '@angular/core';
import { of } from 'rxjs';

import { Brand, DEFAULT_BRAND } from '../theme/brand';
import { SITE_BRAND_SOURCE, SiteBrandService } from '../services/site-brand.service';
import { BrandAssetsService } from '../services/brand-assets.service';
import { ShellChromeService } from '../services/shell-chrome.service';

/**
 * A synchronous brand for a TestBed, so a component that renders shell chrome
 * needs neither an HTTP backend nor `SHARED_ENVIRONMENT` (#67).
 *
 * `ShellChromeService` reaches every template that used to hardcode
 * `user@portfolio:~$`, which is a lot of specs that have no business knowing
 * about the site config. Without this they fail with
 * `NG0201 … ShellChromeService -> SiteBrandService -> InjectionToken
 * SHARED_ENVIRONMENT`, and the obvious repair — provide the real environment
 * and an HTTP client — would leave each of those specs making a real request
 * to a backend that is not there.
 *
 * Supplying the SOURCE rather than stubbing the service keeps the real
 * `ShellChromeService` under test: a spec that overrides `theme` to a
 * non-chrome preset is exercising the actual production mapping.
 *
 * The three services are named explicitly, and returned as a `StaticProvider`
 * ARRAY rather than one provider, because `createInInjectionContext` builds a
 * bare `Injector.create` with no root injector behind it — `providedIn: 'root'`
 * resolves to nothing there. Spread it at the call site:
 * `providers: [...provideTestBrand(), …]`. All three are `useClass`, so a spec
 * that injects none of them constructs none of them.
 *
 * `BrandAssetsService` is the one exception to self-sufficiency: mutating the
 * head is its whole job, so it injects `DOCUMENT`. Every `TestBed` supplies
 * one; a bare `Injector.create` does not, so add
 * `{ provide: DOCUMENT, useValue: document }` beside this when a
 * `createInInjectionContext` case needs it.
 *
 * @param brand fields to override on top of `DEFAULT_BRAND`
 */
export function provideTestBrand(brand: Partial<Brand> = {}): StaticProvider[] {
    return [
        { provide: SITE_BRAND_SOURCE, useValue: of<Brand>({ ...DEFAULT_BRAND, ...brand }) },
        { provide: SiteBrandService, useClass: SiteBrandService, deps: [] },
        { provide: ShellChromeService, useClass: ShellChromeService, deps: [] },
        { provide: BrandAssetsService, useClass: BrandAssetsService, deps: [] },
    ];
}
