import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BlogPostComponent } from './blog-post.component';
import { BlogService } from '@beaconfolio/shared';
import { SeoService } from '../../../services/seo.service';
import { SiteConfigService } from '../../../services/site-config.service';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of, throwError, BehaviorSubject, firstValueFrom } from 'rxjs';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideTestBrand } from '@beaconfolio/shared/testing';

/**
 * #109 — real HTTP 404 for an unknown blog slug on SSR, plus the shared not-found
 * SEO (noindex robots meta + not-found title). The `RESPONSE_INIT` object provided
 * by @angular/ssr is mutated during render; the engine reuses that same reference
 * to build the outgoing Response, so setting `.status = 404` yields a hard 404.
 */
describe('BlogPostComponent — not-found SEO + SSR 404 status (#109)', () => {
  let seoServiceSpy: { updateSeo: any; setJsonLd: any; setNotFound: any };

  function setup(platform: 'server' | 'browser', responseInit: ResponseInit | null, getPostReturn: any) {
    seoServiceSpy = { updateSeo: vi.fn(), setJsonLd: vi.fn(), setNotFound: vi.fn() };
    const blogServiceSpy = { getPost: vi.fn().mockReturnValue(getPostReturn) };
    const paramMapSubject = new BehaviorSubject({ get: (k: string) => (k === 'slug' ? 'ghost-slug' : null) });

    TestBed.configureTestingModule({
      imports: [BlogPostComponent, MockTranslatePipe],
      providers: [
        ...provideTestBrand(),
        provideRouter([]),
        {
            provide: SiteConfigService,
            useValue: {
                config$: of({
                    siteName: 'beaconfolio.com', siteUrl: 'https://beaconfolio.com',
                    ownerName: 'Mock Owner', ownerHeadline: 'Principal Software Engineer',
                    ownerDescription: 'Desc.', socialLinks: [],
                    analyticsId: '',
                }),
            },
        },

        { provide: BlogService, useValue: blogServiceSpy },
        { provide: SeoService, useValue: seoServiceSpy },
        { provide: PLATFORM_ID, useValue: platform },
        { provide: RESPONSE_INIT, useValue: responseInit },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMapSubject.asObservable(),
            snapshot: { paramMap: { get: () => 'ghost-slug' } },
          },
        },
      ],
    });

    const fixture: ComponentFixture<BlogPostComponent> = TestBed.createComponent(BlogPostComponent);
    vi.spyOn(TestBed.inject(Router), 'navigate');
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('sets the SSR response status to 404 when an unknown slug resolves to not-found on the server', () => {
    const responseInit: ResponseInit = { status: 200, headers: new Headers() };
    setup('server', responseInit, of(undefined));

    expect(responseInit.status).toBe(404);
    expect(seoServiceSpy.setNotFound).toHaveBeenCalled();
  });

  it('sets 404 on the server when the API throws (real 404 → HttpClient error path)', () => {
    const responseInit: ResponseInit = { status: 200, headers: new Headers() };
    setup('server', responseInit, throwError(() => ({ status: 404 })));

    expect(responseInit.status).toBe(404);
    expect(seoServiceSpy.setNotFound).toHaveBeenCalled();
  });

  it('does not throw on the server when RESPONSE_INIT is unavailable (null) — still marks not-found SEO', () => {
    setup('server', null, of(undefined));

    expect(seoServiceSpy.setNotFound).toHaveBeenCalled();
  });

  it('leaves the response status untouched on the server for a known slug (still 200)', () => {
    const responseInit: ResponseInit = { status: 200, headers: new Headers() };
    setup('server', responseInit, of({ slug: 'ghost-slug', title: 'Real', content: 'x', tags: [] }));

    expect(responseInit.status).toBe(200);
    expect(seoServiceSpy.setNotFound).not.toHaveBeenCalled();
    expect(seoServiceSpy.updateSeo).toHaveBeenCalled();
  });

  it('marks not-found SEO but never touches HTTP status on the browser', () => {
    const responseInit: ResponseInit = { status: 200, headers: new Headers() };
    setup('browser', responseInit, of(undefined));

    // Browser is not the SSR platform → status must remain the client-side default.
    expect(responseInit.status).toBe(200);
    expect(seoServiceSpy.setNotFound).toHaveBeenCalled();
  });

  it('unixUser$ maps the runtime identity, empty name falls back to owner (#66)', async () => {
    // Against the REAL constructor wiring: the TestBed mock emits 'Mock Owner'.
    const fixture = setup('server', null, of(null));
    expect(await firstValueFrom((fixture.componentInstance as any).unixUser$)).toBe('mock');

    // Empty owner name -> 'owner' fallback, through the same constructor wiring.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BlogPostComponent, MockTranslatePipe],
      providers: [
        ...provideTestBrand(),
        provideRouter([]),
        { provide: SeoService, useValue: { updateSeo: vi.fn(), setJsonLd: vi.fn(), setNotFound: vi.fn() } },
        { provide: BlogService, useValue: { getPost: vi.fn().mockReturnValue(of(null)) } },
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: RESPONSE_INIT, useValue: null },
        { provide: ActivatedRoute, useValue: { paramMap: of({ get: () => 'x' }), snapshot: { paramMap: { get: () => 'x' } } } },
        { provide: SiteConfigService, useValue: { config$: of({ ownerName: '' }) } },
      ],
    });
    const bare = TestBed.createComponent(BlogPostComponent);
    expect(await firstValueFrom((bare.componentInstance as any).unixUser$)).toBe('owner');
  });
});
