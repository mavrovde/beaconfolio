import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { normalizeTheme } from '../theme/theme-presets';
import { SiteBrandService } from './site-brand.service';

/**
 * Applies the chosen preset theme by stamping `data-theme` on the ROOT
 * element, which is what every `[data-theme="..."]` block in the shared
 * stylesheet (`projects/shared/src/styles/theme.css`) matches.
 *
 * Shared by BOTH apps since #67. #339 put this in the public app only, and the
 * admin console therefore stayed terminal-green on every preset — half of the
 * thing #67's first criterion asks for.
 *
 * ## Why the root element, and why during the render
 *
 * The theme has to be in the HTML the visitor receives, or the page paints the
 * default and then repaints — a flash of the wrong theme on first load, worst
 * on the slowest connections. Stamping it behind an `isPlatformBrowser` guard
 * would guarantee that flash, because the server-rendered HTML would then
 * always carry the default.
 *
 * `DOCUMENT` is the right injection on both platforms — on the server it is
 * the document being rendered, in the browser it is the real one — so there is
 * no platform branch here at all. The server serializes only once the
 * application is stable, and the in-flight `HttpClient` request that feeds
 * this is a pending task, so the attribute is always set before serialization.
 * (The admin app is CSR-only, so for it there is no server half at all.)
 *
 * ## Why this is called from the root component's `ngOnInit`, NOT an app
 * ## initializer
 *
 * An app initializer looks like the natural hook, and it is wrong here.
 * `ng build public` runs a route-extraction bootstrap with **no backend
 * behind it**; an initializer that touches a `shareReplay(1)` config stream
 * starts a request that never settles and whose subscription is never torn
 * down — so an RxJS `timeout` does not rescue it either. The build then fails
 * with `TimeoutError: The operation was aborted due to timeout` (measured:
 * **33.479 s** to the abort with the initializer, against **3.370 s** for the
 * green build without it). Route extraction does not render the root
 * template, which is why a read from inside `ngOnInit` has always been safe.
 *
 * A cosmetic choice must not be able to fail a production build.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
    private doc = inject(DOCUMENT);
    private brand = inject(SiteBrandService);

    /** Stamp a preset onto the root element, normalizing anything unknown. */
    apply(theme: string | undefined): void {
        this.doc.documentElement.setAttribute('data-theme', normalizeTheme(theme));
    }

    /**
     * Stamp the default immediately, then upgrade it when the configured value
     * arrives. The eager stamp means the root element is never missing a valid
     * `data-theme`, even if the config never lands.
     *
     * `theme$` is supplied by an app that ALREADY fetches the site config —
     * the public app hands over its `config$`, so the theme costs it no extra
     * request. An app without one (the admin console) omits it and this
     * service makes its own, deliberately narrow, request.
     */
    initialize(theme$: Observable<string | undefined> = this.fetchTheme()): void {
        this.apply(undefined);
        theme$.subscribe({
            next: (theme) => this.apply(theme),
            // The public app's config service already degrades an unreachable
            // backend to its default config; this arm is belt to that's
            // braces, and it is the real path for the admin app's own fetch.
            // A theme may never take an app down.
            error: () => this.apply(undefined),
        });
    }

    /**
     * The theme alone, off the ONE shared brand stream (#67).
     *
     * That stream is the host app's when it supplies `SITE_BRAND_SOURCE` and
     * this library's own single request otherwise — so the admin console pays
     * for exactly one `/config/site` fetch no matter how many of the three
     * shared consumers (theme, brand assets, shell chrome) subscribe to it,
     * and the public app pays for none beyond the one it already makes.
     *
     * It reads the PUBLIC endpoint on purpose: the admin login screen has to
     * be themed before anyone has authenticated, so reading this from the
     * admin-only settings API would leave exactly the one screen a forker sees
     * first unthemed.
     */
    private fetchTheme(): Observable<string | undefined> {
        return this.brand.brand$.pipe(map((b) => b.theme));
    }
}
