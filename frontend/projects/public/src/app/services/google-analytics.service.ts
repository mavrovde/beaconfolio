import { DOCUMENT, Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter, take } from 'rxjs/operators';
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

/** The `id` of the server-rendered GTM `<noscript>` element (#447). */
export const GTM_NOSCRIPT_ID = 'gtm-noscript';

/**
 * The GTM `<noscript>` iframe URL for a container id, or null when the id is
 * absent or unsafe. A constant https origin + a `TAG_ID_PATTERN`-validated id:
 * nothing else can reach the URL.
 */
export function gtmNoscriptUrl(containerId: unknown): string | null {
    const id = safeTagId(containerId);
    return id ? `https://www.googletagmanager.com/ns.html?id=${id}` : null;
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
    private document = inject(DOCUMENT);

    // The measurement id comes from the runtime site config (#65) — empty
    // disables analytics entirely; no id is ever baked into the bundle.
    private googleAnalyticsId = '';

    // The GTM container id, same runtime source (#447). When this is set the
    // container is installed and the gtag path is NOT taken: GTM and gtag are
    // two installs of the SAME measurement, and running both double-counts
    // every pageview. Browser-side only — the <noscript> half does NOT read
    // this field, because initialize() never assigns it off-browser; it reads
    // the config itself in `renderNoscript()` below.
    public gtmContainerId = '';

    private isInitialized = false;

    /**
     * The <noscript> half of the container install (#447), written into the
     * SERVER-rendered document as the first child of `<body>` — where Google's
     * snippet puts it.
     *
     * Deliberately NOT part of `initialize()`: that method returns early
     * off-browser, and a <noscript> iframe injected by JavaScript is a
     * contradiction in terms. A visitor whose browser runs no script never
     * runs Angular, so the server-rendered HTML is the only place this tag can
     * reach them — and in a browser that DOES run script, a DOM-built iframe
     * would load and count the pageview a second time. Hence server-only.
     *
     * Built with `createElement`/`setAttribute` on the injected document
     * rather than an Angular `[src]` binding: an iframe `src` is a
     * resource-URL context, which Angular only accepts through
     * `bypassSecurityTrustResourceUrl` (Sonar `typescript:S6268`). The URL is
     * `gtmNoscriptUrl` — a constant origin plus a pattern-validated id — so
     * there is nothing for the sanitizer to protect and no bypass to justify.
     */
    public renderNoscript(): void {
        if (isPlatformBrowser(this.platformId)) {
            return;
        }
        this.siteConfig.config$.pipe(take(1)).subscribe((cfg) => {
            const url = gtmNoscriptUrl(cfg.gtmContainerId);
            const body = this.document.body;
            if (!url || this.document.getElementById(GTM_NOSCRIPT_ID)) {
                return;
            }
            const noscript = this.document.createElement('noscript');
            noscript.id = GTM_NOSCRIPT_ID;
            const iframe = this.document.createElement('iframe');
            iframe.setAttribute('src', url);
            iframe.setAttribute('height', '0');
            iframe.setAttribute('width', '0');
            iframe.setAttribute('style', 'display:none;visibility:hidden');
            noscript.appendChild(iframe);
            body.insertBefore(noscript, body.firstChild);
        });
    }

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
