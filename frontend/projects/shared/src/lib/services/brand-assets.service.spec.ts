import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Observable, Subject, of, throwError } from 'rxjs';

import { BrandAssetsService } from './brand-assets.service';
import { SITE_BRAND_SOURCE } from './site-brand.service';
import { Brand, DEFAULT_BRAND } from '../theme/brand';

const brandWith = (over: Partial<Brand> = {}): Brand => ({ ...DEFAULT_BRAND, ...over });

function service(source: Observable<Brand> = of(DEFAULT_BRAND)): BrandAssetsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            { provide: SITE_BRAND_SOURCE, useValue: source },
            // The REAL document: this service's entire job is to mutate the
            // head, and a stub would test the stub.
            { provide: DOCUMENT, useValue: document },
        ],
    });
    return TestBed.inject(BrandAssetsService);
}

const icon = () => document.querySelector<HTMLLinkElement>("link[rel~='icon']");
const fontLink = () => document.getElementById('brand-font') as HTMLLinkElement | null;

describe('BrandAssetsService (#67)', () => {
    beforeEach(() => {
        // The bundled state `index.html` ships, including the `type` that
        // contradicts the shipped file's actual bytes.
        document.head.innerHTML =
            '<link rel="icon" type="image/png" href="assets/favicon.png">' +
            '<link id="brand-font" rel="stylesheet" href="https://fonts.example/vt323">';
        document.documentElement.removeAttribute('style');
    });

    afterEach(() => {
        document.head.innerHTML = '';
        document.documentElement.removeAttribute('style');
    });

    describe('when nothing is configured', () => {
        // The bundled asset is the default in the most literal sense: it is
        // already in the HTML. Overwriting it with itself would be harmless;
        // CLEARING it would not, which is why each apply is guarded.
        it('leaves every bundled link exactly as it found it', () => {
            service().initialize();

            expect(icon()?.getAttribute('href')).toBe('assets/favicon.png');
            expect(icon()?.getAttribute('type')).toBe('image/png');
            expect(fontLink()?.getAttribute('href')).toBe('https://fonts.example/vt323');
            expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('');
        });
    });

    describe('when the config names its own assets', () => {
        it('points the existing favicon link at the configured url', () => {
            service(of(brandWith({ faviconUrl: 'https://cdn.example/fav.svg' }))).initialize();
            expect(icon()?.getAttribute('href')).toBe('https://cdn.example/fav.svg');
        });

        // The shipped `favicon.png` is a JPEG, so the bundled `type` was
        // already wrong; a configured URL can be any format at all. An omitted
        // type is honest, a declared one would be a guess.
        it('drops the type attribute rather than declaring a format it cannot know', () => {
            service(of(brandWith({ faviconUrl: '/assets/fav.ico' }))).initialize();
            expect(icon()?.hasAttribute('type')).toBe(false);
        });

        it('creates a favicon link when the document has none', () => {
            document.head.innerHTML = '';
            service(of(brandWith({ faviconUrl: '/assets/fav.ico' }))).initialize();
            expect(icon()?.getAttribute('href')).toBe('/assets/fav.ico');
        });

        it('re-points the bundled font stylesheet', () => {
            service(of(brandWith({ fontCssUrl: 'https://fonts.example/inter' }))).initialize();
            expect(fontLink()?.getAttribute('href')).toBe('https://fonts.example/inter');
        });

        it('creates the font link when the document has none', () => {
            document.head.innerHTML = '';
            service(of(brandWith({ fontCssUrl: 'https://fonts.example/inter' }))).initialize();
            expect(fontLink()?.getAttribute('rel')).toBe('stylesheet');
            expect(fontLink()?.getAttribute('href')).toBe('https://fonts.example/inter');
        });

        // BOTH families: `classic` pairs a serif body with a monospace code
        // face, so overriding one would restyle half the page and leave the
        // other half on the preset's own family.
        it('overrides both font-family tokens inline on the root element', () => {
            service(of(brandWith({ fontFamily: "'Inter', sans-serif" }))).initialize();

            const style = document.documentElement.style;
            expect(style.getPropertyValue('--font-sans')).toBe("'Inter', sans-serif");
            expect(style.getPropertyValue('--font-mono')).toBe("'Inter', sans-serif");
        });
    });

    // A brand may not take an app down — the same contract `ThemeService` and
    // `SiteBrandService` hold. The supplied stream already degrades; this arm
    // is what stops a broken one from propagating.
    it('falls back to the default brand when the stream errors', () => {
        service(throwError(() => new Error('boom'))).initialize();
        expect(icon()?.getAttribute('href')).toBe('assets/favicon.png');
    });

    it('applies nothing until the stream emits', () => {
        service(new Subject<Brand>()).initialize();
        expect(icon()?.getAttribute('href')).toBe('assets/favicon.png');
    });

    it('accepts an explicit stream in place of the shared one', () => {
        const svc = service(of(DEFAULT_BRAND));
        svc.initialize(of(brandWith({ faviconUrl: '/explicit.png' })));
        expect(icon()?.getAttribute('href')).toBe('/explicit.png');
    });
});
