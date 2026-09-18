import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { Observable, firstValueFrom, of } from 'rxjs';

import { ShellChromeService } from './shell-chrome.service';
import { SITE_BRAND_SOURCE } from './site-brand.service';
import { Brand, DEFAULT_BRAND } from '../theme/brand';

function service(over: Partial<Brand> = {}): ShellChromeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
        providers: [
            { provide: SITE_BRAND_SOURCE, useValue: of<Brand>({ ...DEFAULT_BRAND, ...over }) },
        ],
    });
    return TestBed.inject(ShellChromeService);
}

const first = <T>(o: Observable<T>) => firstValueFrom(o);

describe('ShellChromeService (#67)', () => {
    describe('under the terminal preset', () => {
        it('renders a prompt from the CONFIGURED site name, not a literal', async () => {
            const svc = service({ siteName: 'Acme Portfolio' });
            await expect(first(svc.prompt())).resolves.toBe('user@acme-portfolio:~$');
        });

        it('honours the path and the account', async () => {
            const svc = service({ siteName: 'Acme' });
            await expect(first(svc.prompt('~/blog'))).resolves.toBe('user@acme:~/blog$');
            await expect(first(svc.prompt('~', 'admin'))).resolves.toBe('admin@acme:~$');
        });

        it('exposes the account half alone, for templates that colour it', async () => {
            const svc = service({ siteName: 'Acme' });
            await expect(first(svc.account())).resolves.toBe('user@acme');
            await expect(first(svc.account('admin'))).resolves.toBe('admin@acme');
        });

        it('renders a full command line', async () => {
            const svc = service({ siteName: 'Acme' });
            await expect(
                first(svc.commandLine('./login.sh', { user: 'admin' })),
            ).resolves.toBe('admin@acme:~$ ./login.sh');
        });

        it('prefixes the wordmark with the terminal marker', async () => {
            const svc = service({ ownerName: 'Ada Lovelace' });
            await expect(first(svc.wordmark$)).resolves.toBe('>_ AL');
        });

        it('reports that chrome is on', async () => {
            await expect(first(service().chrome$)).resolves.toBe(true);
        });
    });

    // The point of the whole service: a serif, document-like preset that still
    // greets a visitor with `user@host:~$` reads as a rendering bug.
    describe.each([['dark'], ['light'], ['modern'], ['classic']])(
        'under the %s preset',
        (theme) => {
            it('renders no prompt at all', async () => {
                const svc = service({ theme, siteName: 'Acme' });
                await expect(first(svc.prompt())).resolves.toBe('');
                await expect(first(svc.account())).resolves.toBe('');
                await expect(first(svc.chrome$)).resolves.toBe(false);
            });

            it('drops the terminal marker from the wordmark', async () => {
                const svc = service({ theme, ownerName: 'Ada Lovelace' });
                await expect(first(svc.wordmark$)).resolves.toBe('AL');
            });

            // An empty panel title above a login form reads as a broken page,
            // so this one degrades to a caption rather than to nothing.
            it('renders a caption in place of a command line', async () => {
                const svc = service({ theme, siteName: 'Acme Portfolio' });
                await expect(first(svc.commandLine('./login.sh'))).resolves.toBe('Acme Portfolio');
                await expect(
                    first(svc.commandLine('./login.sh', { plain: 'Sign in' })),
                ).resolves.toBe('Sign in');
            });
        },
    );

    describe('the hostname derived from the site name', () => {
        it.each([
            ['My Portfolio', 'my-portfolio'],
            ['beaconfolio.com', 'beaconfolio.com'],
            ['Ünïcode Wörks', 'ncode-wrks'],
            ['   ', 'portfolio'],
            ['!!!', 'portfolio'],
        ])('turns %s into %s', async (siteName, host) => {
            await expect(first(service({ siteName }).host$)).resolves.toBe(host);
        });
    });

    describe('the wordmark derived from the owner name', () => {
        it.each([
            ['Ada Lovelace', 'AL'],
            ['Jane Q. Doe', 'JQ'],
            ['Prince', 'P'],
            ['  ', 'PO'],
            ['???', 'PO'],
            // No letter in the owner name, so the site name supplies the mark
            // verbatim — two punctuation marks beat an invisible header link.
            ['!!!', 'PO'],
        ])('turns %s into %s', async (ownerName, mark) => {
            const svc = service({ theme: 'light', ownerName, siteName: 'Portfolio' });
            await expect(first(svc.wordmark$)).resolves.toBe(mark);
        });

        // Neither name yields anything: the header still has to render
        // SOMETHING, or the site's only home link becomes invisible. Reachable
        // only past `normalizeBrand`, which guarantees a non-empty site name —
        // so this pins the contract of the TYPE, which allows `''`.
        it('falls back to a placeholder when neither name has a character', async () => {
            const svc = service({ theme: 'light', ownerName: '???', siteName: '' });
            await expect(first(svc.wordmark$)).resolves.toBe('??');
        });
    });

    it('exposes the site name and the configured logo url', async () => {
        const svc = service({ siteName: 'Acme', logoUrl: '/assets/acme.svg' });
        await expect(first(svc.siteName$)).resolves.toBe('Acme');
        await expect(first(svc.logoUrl$)).resolves.toBe('/assets/acme.svg');
    });
});
