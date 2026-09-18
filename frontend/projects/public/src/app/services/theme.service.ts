import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { SiteConfigService, normalizeTheme } from './site-config.service';

/**
 * Applies the chosen preset theme (#339) by stamping `data-theme` on the ROOT
 * element, which is what every `[data-theme="..."]` block in `styles.css`
 * matches.
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
 *
 * ## Why this is called from `AppComponent.ngOnInit`, NOT an app initializer
 *
 * An app initializer looks like the natural hook, and it is wrong here.
 * `ng build public` runs a route-extraction bootstrap with **no backend
 * behind it**; an initializer that touches `config$` starts a request that
 * never settles, and because `config$` is a `shareReplay(1)` its subscription
 * is never torn down — so an RxJS `timeout` does not rescue it either. The
 * build then fails with `TimeoutError: The operation was aborted due to
 * timeout` (measured: 4.6s for a clean build, vs. a 34s abort with the
 * initializer). Route extraction does not render the root template, which is
 * why the identical `config$` read behind `gtmNoscriptUrl$` has always been
 * safe — and it is why this one lives beside it, in the same `ngOnInit`.
 *
 * A cosmetic choice must not be able to fail a production build.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
    private doc = inject(DOCUMENT);
    private siteConfig = inject(SiteConfigService);

    /** Stamp a preset onto the root element, normalizing anything unknown. */
    apply(theme: string | undefined): void {
        this.doc.documentElement.setAttribute('data-theme', normalizeTheme(theme));
    }

    /**
     * Stamp the default immediately, then upgrade it when the configured value
     * arrives. The eager stamp means the root element is never missing a valid
     * `data-theme`, even if the config never lands.
     */
    initialize(): void {
        this.apply(undefined);
        this.siteConfig.config$.subscribe({
            next: (config) => this.apply(config.theme),
            // `SiteConfigService` already degrades an unreachable backend to
            // the default config; this arm is belt to that's braces. A theme
            // may never take the site down.
            error: () => this.apply(undefined),
        });
    }
}
