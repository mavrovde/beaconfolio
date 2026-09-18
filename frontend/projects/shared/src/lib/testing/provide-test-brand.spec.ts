import { Injector } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { provideTestBrand } from './provide-test-brand';
import { createInInjectionContext } from './create-in-injection-context';
import { SITE_BRAND_SOURCE, SiteBrandService } from '../services/site-brand.service';
import { ShellChromeService } from '../services/shell-chrome.service';
import { BrandAssetsService } from '../services/brand-assets.service';
import { DEFAULT_BRAND } from '../theme/brand';

/**
 * The helper 28 app specs depend on (#67). Its contract is not "returns some
 * providers" — it is that the three brand services RESOLVE, in both injector
 * shapes the repo uses, without an HTTP backend or `SHARED_ENVIRONMENT`. Both
 * halves were real failures during #67: field-initialised `inject()` calls in
 * `SiteBrandService` broke 20 public spec files with `NG0201 … ->
 * SHARED_ENVIRONMENT`, and the bare-`Injector.create` shape below broke five
 * more with `NG0201: No provider found for ShellChromeService`.
 */
describe('provideTestBrand (#67)', () => {
    it('supplies the DEFAULT brand when given no overrides', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [...provideTestBrand()] });

        await expect(
            firstValueFrom(TestBed.inject(SiteBrandService).brand$),
        ).resolves.toEqual(DEFAULT_BRAND);
    });

    it('merges overrides onto the default rather than replacing it', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [...provideTestBrand({ siteName: 'Acme Portfolio' })],
        });

        await expect(firstValueFrom(TestBed.inject(SITE_BRAND_SOURCE))).resolves.toEqual({
            ...DEFAULT_BRAND,
            siteName: 'Acme Portfolio',
        });
    });

    // The REAL service, not a stub: a spec that overrides `theme` to a
    // non-chrome preset must be exercising the production mapping, or every
    // template assertion downstream is measuring a test double.
    it('keeps the real ShellChromeService under test', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [...provideTestBrand({ siteName: 'Acme', theme: 'terminal' })],
        });
        const terminal = TestBed.inject(ShellChromeService);
        await expect(firstValueFrom(terminal.prompt('~/blog'))).resolves.toBe(
            'user@acme:~/blog$',
        );

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [...provideTestBrand({ siteName: 'Acme', theme: 'classic' })],
        });
        await expect(firstValueFrom(TestBed.inject(ShellChromeService).prompt())).resolves.toBe(
            '',
        );
    });

    // `Injector.create` has NO root injector behind it, so `providedIn: 'root'`
    // resolves to nothing there. That is why the helper names the services as
    // explicit `useClass` entries instead of providing the token alone — this
    // case is what pins it.
    it('resolves the brand services inside a bare Injector.create', () => {
        const injector = Injector.create({ providers: provideTestBrand({ logoUrl: '/a.svg' }) });

        expect(injector.get(SiteBrandService)).toBeInstanceOf(SiteBrandService);
        expect(injector.get(ShellChromeService)).toBeInstanceOf(ShellChromeService);
    });

    // The one service the helper canNOT make self-sufficient: writing to the
    // head is its entire job, so it injects `DOCUMENT`. Every `TestBed` has
    // one; a bare `Injector.create` does not. Pinned in BOTH directions so the
    // requirement is visible rather than discovered as an `NG0201` by the next
    // spec that reaches for it.
    it('needs a DOCUMENT alongside it for BrandAssetsService', () => {
        expect(() =>
            Injector.create({ providers: provideTestBrand() }).get(BrandAssetsService),
        ).toThrow(/DocumentToken/);

        const injector = Injector.create({
            providers: [
                ...provideTestBrand({ faviconUrl: '/fav.ico' }),
                { provide: DOCUMENT, useValue: document },
            ],
        });
        expect(injector.get(BrandAssetsService)).toBeInstanceOf(BrandAssetsService);
    });

    it('is spreadable into a createInInjectionContext provider list', async () => {
        const shell = createInInjectionContext(ShellChromeService, [
            ...provideTestBrand({ ownerName: 'Ada Lovelace', theme: 'terminal' }),
        ]);

        await expect(firstValueFrom(shell.wordmark$)).resolves.toBe('>_ AL');
    });
});
