import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { describe, it, expect, beforeEach } from 'vitest';
import { Subject, throwError } from 'rxjs';

import { ThemeService } from './theme.service';
import { DEFAULT_SITE_CONFIG, SiteConfig, SiteConfigService, THEME_PRESETS } from './site-config.service';

/** The attribute as it currently stands on the root element. */
const stamped = () => document.documentElement.getAttribute('data-theme');

function serviceWith(config$: unknown): ThemeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            { provide: SiteConfigService, useValue: { config$ } },
            // The real DOCUMENT: this service's entire job is to mutate the
            // root element, and a stub would test the stub.
            { provide: DOCUMENT, useValue: document },
        ],
    });
    return TestBed.inject(ThemeService);
}

describe('ThemeService (#339)', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('data-theme');
    });

    it.each(THEME_PRESETS.map((p) => [p]))('stamps the %s preset verbatim', (preset) => {
        serviceWith(new Subject<SiteConfig>()).apply(preset);
        expect(stamped()).toBe(preset);
    });

    // A name no `[data-theme="..."]` block matches would leave the page on
    // whatever `:root` holds — half-themed, which is worse than the default.
    it.each([['neon-vaporwave'], [''], [undefined]])(
        'normalizes the unknown value %s to the default preset',
        (value) => {
            serviceWith(new Subject<SiteConfig>()).apply(value as string | undefined);
            expect(stamped()).toBe('terminal');
        }
    );

    // The eager stamp is the point: a visitor whose config request is still in
    // flight must never see an element with NO `data-theme` at all.
    it('stamps the default synchronously, before the config arrives', () => {
        const config$ = new Subject<SiteConfig>();
        serviceWith(config$).initialize();
        expect(stamped()).toBe('terminal');

        config$.next({ ...DEFAULT_SITE_CONFIG, theme: 'light' });
        expect(stamped()).toBe('light');
    });

    it('upgrades to the configured preset when the config lands', () => {
        const config$ = new Subject<SiteConfig>();
        serviceWith(config$).initialize();
        config$.next({ ...DEFAULT_SITE_CONFIG, theme: 'modern' });
        expect(stamped()).toBe('modern');
    });

    // SiteConfigService already degrades an unreachable backend, so this arm
    // only fires if that contract is ever broken. It exists because a theme
    // must not be able to take the site down.
    it('falls back to the default when the config stream errors', () => {
        serviceWith(throwError(() => new Error('boom'))).initialize();
        expect(stamped()).toBe('terminal');
    });
});
