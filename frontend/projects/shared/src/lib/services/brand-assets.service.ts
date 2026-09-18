import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Brand, DEFAULT_BRAND } from '../theme/brand';
import { SiteBrandService } from './site-brand.service';

/** The `<link>` this service owns, so a second apply updates rather than adds. */
const FONT_LINK_ID = 'brand-font';

/**
 * Points the document's brand assets at whatever the config names (#67).
 *
 * Sibling of `ThemeService`: that one decides which token SET paints, this one
 * decides which FILES load. Both mutate the injected `DOCUMENT` and neither
 * branches on the platform, so both run identically under SSR and in the
 * browser.
 *
 * ## Why this overrides rather than replaces
 *
 * `index.html` keeps a real favicon link and a real font link, and this
 * service rewrites their `href` only when the config names something else.
 * The alternative — an empty head that the service fills once the config
 * lands — would put a round-trip between the first byte and the right font,
 * i.e. a flash of fallback type on every cold load, to buy nothing for the
 * overwhelmingly common case of an owner who never sets these. So the bundled
 * asset is the default in the most literal sense: it is in the HTML.
 *
 * ## The font takes TWO values, and one alone does nothing
 *
 * `fontCssUrl` loads a face; `fontFamily` decides what paints. A stylesheet
 * with no family override changes nothing visible (the active preset's
 * `--font-sans` still wins), and a family with no stylesheet silently falls
 * through to the next name in the list. They are applied together here and
 * documented together in `.env.example` for that reason.
 */
@Injectable({ providedIn: 'root' })
export class BrandAssetsService {
    private doc = inject(DOCUMENT);
    private brand = inject(SiteBrandService);

    /**
     * Apply the configured assets, and keep the bundled ones until they land.
     *
     * Called from the root component's `ngOnInit` for the same reason
     * `ThemeService.initialize` is — an app initializer that touches the
     * config stream aborts `ng build`'s route extraction.
     */
    initialize(brand$: Observable<Brand> = this.brand.brand$): void {
        brand$.subscribe({
            next: (brand) => this.apply(brand),
            // The streams above already degrade an unreachable backend; this
            // arm is what keeps a broken one from taking the app down.
            error: () => this.apply(DEFAULT_BRAND),
        });
    }

    /** Write the non-empty overrides into the document. */
    apply(brand: Brand): void {
        if (brand.faviconUrl) {
            this.setFavicon(brand.faviconUrl);
        }
        if (brand.fontCssUrl) {
            this.setFontStylesheet(brand.fontCssUrl);
        }
        if (brand.fontFamily) {
            this.setFontFamily(brand.fontFamily);
        }
    }

    private setFavicon(href: string): void {
        let link = this.doc.querySelector<HTMLLinkElement>("link[rel~='icon']");
        if (!link) {
            link = this.doc.createElement('link');
            link.setAttribute('rel', 'icon');
            this.doc.head.appendChild(link);
        }
        // The bundled link may carry a `type` for the bundled file's format.
        // A configured URL can be any format, and an honest omission beats a
        // declared type that contradicts the bytes — which is exactly what the
        // shipped `favicon.png` did: the file is a JPEG.
        link.removeAttribute('type');
        link.setAttribute('href', href);
    }

    private setFontStylesheet(href: string): void {
        let link = this.doc.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
        if (!link) {
            link = this.doc.createElement('link');
            link.setAttribute('id', FONT_LINK_ID);
            link.setAttribute('rel', 'stylesheet');
            this.doc.head.appendChild(link);
        }
        link.setAttribute('href', href);
    }

    /**
     * An inline custom property on the root element.
     *
     * This is the one place a value can beat a `[data-theme]` block without
     * editing the shared stylesheet: the element's own `style` attribute wins
     * over every selector, whatever its specificity or layer. Both families
     * are set, because a preset that distinguishes them (`classic` pairs a
     * serif body with a monospace code face) would otherwise apply the
     * override to half the page.
     */
    private setFontFamily(family: string): void {
        const root = this.doc.documentElement;
        root.style.setProperty('--font-sans', family);
        root.style.setProperty('--font-mono', family);
    }
}
