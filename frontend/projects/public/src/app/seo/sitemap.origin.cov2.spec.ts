import { describe, it, expect } from 'vitest';
import { buildRobotsTxt, normalizeSiteUrl, renderRobotsTxt, requestOrigin } from './sitemap';

/**
 * The two values that reach every generated file (robots.txt, llms.txt,
 * llms-full.txt, sitemap.xml) from OUTSIDE the deployment's own config: the
 * request's forwarded/Host headers (client-controlled) and the backend's
 * `site_url`. Sonar `tssecurity:S5131` traces both into the response body, so
 * each is validated before it is echoed.
 */
describe('requestOrigin — client headers are validated before they are echoed', () => {
    it.each([
        ['markup in the forwarded host', { 'x-forwarded-host': '<script>alert(1)</script>' }],
        ['a path smuggled into the host', { 'x-forwarded-host': 'evil.example/<x>' }],
        ['whitespace inside the host', { host: 'a.example b' }],
        ['a userinfo part', { host: 'user@a.example' }],
        ['a non-numeric port', { host: 'a.example:80x' }],
    ])('degrades %s to localhost', (_label, headers) => {
        expect(requestOrigin(headers, 'http')).toBe('http://localhost');
    });

    it('accepts plain hostnames, ports and bracketed IPv6 literals', () => {
        expect(requestOrigin({ host: 'Sub.Example-1.com:8443' }, 'https')).toBe('https://Sub.Example-1.com:8443');
        expect(requestOrigin({ host: '[::1]:4000' }, 'http')).toBe('http://[::1]:4000');
        expect(requestOrigin({ host: '127.0.0.1' }, 'http')).toBe('http://127.0.0.1');
    });

    it('accepts only http/https as the scheme, case-insensitively', () => {
        expect(requestOrigin({ 'x-forwarded-proto': 'HTTPS', host: 'a.example' }, 'http')).toBe('https://a.example');
        expect(requestOrigin({ 'x-forwarded-proto': 'javascript', host: 'a.example' }, 'https')).toBe(
            'https://a.example',
        );
        expect(requestOrigin({ 'x-forwarded-proto': '<b>', host: 'a.example' }, 'gopher')).toBe('http://a.example');
    });

    // End to end through a renderer: a hostile Host on a request that finds the
    // backend unreachable (so the request origin IS the site URL) never
    // reaches the body.
    it('keeps a hostile Host out of robots.txt when the backend is down', async () => {
        const origin = requestOrigin({ host: '"><script>alert(1)</script>' }, 'http');
        const body = await renderRobotsTxt(() => Promise.reject(new Error('down')), origin);
        expect(body).not.toContain('<script>');
        expect(body).toContain('Sitemap: http://localhost/sitemap.xml');
    });
});

describe('normalizeSiteUrl — the backend SITE_URL is parsed, not trusted as text', () => {
    it('keeps an ordinary site URL, minus the trailing slash', () => {
        expect(normalizeSiteUrl('https://example.com/')).toBe('https://example.com');
        expect(normalizeSiteUrl('https://example.com/sub/')).toBe('https://example.com/sub');
    });

    it.each(['', 'not a url', 'javascript:alert(1)', 'data:text/html,<b>', 'ftp://example.com'])(
        'rejects %j',
        (value) => {
            expect(normalizeSiteUrl(value)).toBe('');
        },
    );

    it('percent-encodes markup-shaped path characters', () => {
        const url = normalizeSiteUrl('https://example.com/<script>');
        expect(url).not.toContain('<');
        expect(url).toBe('https://example.com/%3Cscript%3E');
    });

    it('falls back to the request origin when the configured value is unusable', async () => {
        const body = await renderRobotsTxt(
            () => Promise.resolve({ site_url: 'javascript:alert(1)' }),
            'https://req.example',
        );
        expect(body).toContain('Sitemap: https://req.example/sitemap.xml');
        expect(body).not.toContain('javascript:');
    });

    // The robots builder itself is unchanged: it trusts the config it is given.
    it('leaves buildRobotsTxt a pure function of its config', () => {
        expect(
            buildRobotsTxt({
                siteUrl: 'https://a.example',
                siteName: '',
                ownerName: '',
                ownerHeadline: '',
                ownerDescription: '',
                availability: '',
                aiCrawlerPolicy: 'allow',
            }),
        ).toContain('Sitemap: https://a.example/sitemap.xml');
    });
});
