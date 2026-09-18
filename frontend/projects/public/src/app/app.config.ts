import {
  ApplicationConfig,
  inject,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { map } from 'rxjs/operators';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { HttpBackend, provideHttpClient } from '@angular/common/http';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

import { routes } from './app.routes';
import { SsrHttpBackend } from './interceptors/ssr-http-backend';
import {
  SITE_BRAND_SOURCE,
  provideSharedEnvironment,
  provideAuthTokenProvider,
} from '@beaconfolio/shared';
import { environment } from '../environments/environment';
import { SiteConfigService, toBrand } from './services/site-config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    // The public app declares NO change-detection driver otherwise: `angular.json`
    // ships no zone.js polyfill for the public build, so relying on an implicit
    // zone means async property mutations silently never repaint in the browser
    // (the #94 class of bug). Commit explicitly to zoneless change detection (#105)
    // — components mutating plain props in async callbacks must trigger CD via
    // `ChangeDetectorRef.markForCheck()`, signals, or the `async` pipe.
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      })
    ),
    // Public app is unauthenticated: no auth interceptor needed. The SSR
    // URL-rewriting (relative -> absolute container addresses) happens in
    // `SsrHttpBackend`, *after* Angular's HTTP transfer-cache interceptor has
    // already computed its cache key from the original (server/client-identical)
    // request URL — so the browser reuses the SSR-cached response on hydration
    // instead of re-fetching (fixes the blog "flash to home", #25). The backend
    // delegates to `HttpXhrBackend`, keeping the browser on its long-working XHR
    // path (so the `/stats/public` browser fetch keeps working, #94). See
    // ssr-http-backend.ts for the full rationale.
    provideHttpClient(),
    { provide: HttpBackend, useClass: SsrHttpBackend },
    provideClientHydration(withEventReplay()),
    provideSharedEnvironment(environment),
    provideAuthTokenProvider(() => null),
    // Hand the shared library the config stream this app ALREADY has (#67).
    // `ThemeService`, `BrandAssetsService` and `ShellChromeService` all read
    // their input from `SiteBrandService`, which falls back to a request of
    // its own when nothing is provided here — three extra in-flight requests
    // for fields `config$` already carries, and every in-flight request is
    // something `ng build`'s route extraction can hang on.
    //
    // A FACTORY, not a value: it must not construct `SiteConfigService` (whose
    // constructor issues the fetch) until something actually subscribes.
    {
      provide: SITE_BRAND_SOURCE,
      useFactory: () => inject(SiteConfigService).config$.pipe(map(toBrand)),
    },
  ],
};
