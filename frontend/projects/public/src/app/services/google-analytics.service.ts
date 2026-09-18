import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { SiteConfigService } from './site-config.service';

/** A container id is interpolated into a script URL and an iframe src, so it
 *  must never be able to smuggle markup. GTM and GA ids are [A-Za-z0-9-];
 *  anything else is dropped rather than escaped. Shared by both install
 *  halves so the browser script and the SSR <noscript> cannot disagree. */
export const TAG_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * Normalize a tag id to a SAFE string, or '' (this codebase's documented off
 * switch) for anything else.
 *
 * The `typeof` guard is not defensive noise. `TAG_ID_PATTERN.test(undefined)`
 * coerces its argument to the STRING "undefined", which is pure letters and
 * therefore MATCHES — so a missing field would have sailed through the regex
 * and produced `ns.html?id=undefined`. A pre-#447 backend omits the field
 * entirely, which is exactly that case.
 */
export function safeTagId(value: unknown): string {
    return typeof value === 'string' && TAG_ID_PATTERN.test(value) ? value : '';
}

// Declare gtag as a global variable
declare const gtag: (...args: unknown[]) => void;

@Injectable({
    providedIn: 'root'
})
export class GoogleAnalyticsService {
    private platformId = inject(PLATFORM_ID);
    private router = inject(Router);
    private siteConfig = inject(SiteConfigService);
    private sanitizer = inject(DomSanitizer);

    // The measurement id comes from the runtime site config (#65) — empty
    // disables analytics entirely; no id is ever baked into the bundle.
    private googleAnalyticsId = '';

    // The GTM container id, same runtime source (#447). When this is set the
    // container is installed and the gtag path is NOT taken: GTM and gtag are
    // two installs of the SAME measurement, and running both double-counts
    // every pageview. Readable so the root template can render the <noscript>
    // half server-side, where a browser-injected one would be meaningless.
    public gtmContainerId = '';

    private isInitialized = false;

    /**
     * The <noscript> half of the container install (#447), as a stream the root
     * template renders with the async pipe.
     *
     * Deliberately NOT derived from `initialize()`: that method returns early
     * off-browser, so anything it sets is absent from the server-rendered HTML
     * — and a <noscript> iframe injected by JavaScript is a contradiction in
     * terms. This path runs on BOTH platforms, which is the only way the tag
     * reaches a visitor whose browser runs no script.
     *
     * Emits null when no container is configured, so the template renders
     * nothing at all rather than an iframe pointing at an empty id.
     */
    public readonly gtmNoscriptUrl$: Observable<SafeResourceUrl | null> =
        this.siteConfig.config$.pipe(
            map((cfg) => {
                const id = safeTagId(cfg.gtmContainerId);
                return id
                    ? this.sanitizer.bypassSecurityTrustResourceUrl(
                          `https://www.googletagmanager.com/ns.html?id=${id}`
                      )
                    : null;
            })
        );

    public initialize() {
        if (!isPlatformBrowser(this.platformId) || this.isInitialized) {
            return;
        }
        // config$ is a one-shot shareReplay stream; take(1) both bounds the
        // subscription and re-checks the guards once the id is known.
        this.siteConfig.config$.pipe(take(1)).subscribe((cfg) => {
            // The id is interpolated into an inline <script> and a URL — a
            // config value must never be able to smuggle markup/JS. GA
            // measurement ids are [A-Za-z0-9-]; anything else is dropped.
            // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: assigns a private service field and injects <script> tags — nothing template-bound.
            this.googleAnalyticsId = safeTagId(cfg.analyticsId);
            // Same guard, same reason: the container id is interpolated into a
            // script URL and an iframe src, so a config value must never be
            // able to smuggle markup. GTM ids are [A-Za-z0-9-] like GA ones.
            // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: assigns a service field read by the root template's @if, not a bound expression mutated after CD.
            this.gtmContainerId = safeTagId(cfg.gtmContainerId);

            if (this.gtmContainerId) {
                // GTM WINS. The gtag install is skipped entirely — not merely
                // reordered — so a deployment that sets both does not report
                // every pageview twice.
                this.loadGtmContainer();
                // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: private guard flag, nothing template-bound.
                this.isInitialized = true;
                return;
            }

            if (this.googleAnalyticsId) {
                this.loadScript();
                this.initGtag();
                this.trackPageViews();
                // eslint-disable-next-line no-restricted-syntax -- cd-safety-ok: private guard flag, nothing template-bound.
                this.isInitialized = true;
            }
        });
    }

    // The CANONICAL container install (Google's own snippet): seed dataLayer
    // with the gtm.start event, then load gtm.js. The gtag/js endpoint also
    // accepts a GTM- id and was what this app used before #447, but gtm.js is
    // the documented loader and is what Tag Manager's own tooling expects.
    private loadGtmContainer() {
        const scriptId = 'gtm-container-script';
        if (document.getElementById(scriptId)) {
            return;
        }
        const w = window as unknown as { dataLayer?: unknown[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

        const script = document.createElement('script');
        script.id = scriptId;
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtm.js?id=${this.gtmContainerId}`;
        document.head.appendChild(script);
    }

    private loadScript() {
        const scriptId = 'google-analytics-script';
        if (document.getElementById(scriptId)) {
            return;
        }
        const script = document.createElement('script');
        script.id = scriptId;
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${this.googleAnalyticsId}`;
        document.head.appendChild(script);
    }

    private initGtag() {
        const scriptId = 'google-analytics-init';
        if (document.getElementById(scriptId)) {
            return;
        }
        const script = document.createElement('script');
        script.id = scriptId;
        script.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      if (!window.gtag) {
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag;
        gtag('js', new Date());
        gtag('config', '${this.googleAnalyticsId}');
      }
    `;
        document.head.appendChild(script);
    }

    private trackPageViews() {
        this.router.events
            .pipe(filter(event => event instanceof NavigationEnd))
            .subscribe((event) => {
                if (typeof gtag !== 'undefined') {
                    gtag('config', this.googleAnalyticsId, {
                        'page_path': (event as NavigationEnd).urlAfterRedirects
                    });
                }
            });
    }
}
