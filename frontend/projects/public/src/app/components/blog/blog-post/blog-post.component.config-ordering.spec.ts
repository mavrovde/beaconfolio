import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ReplaySubject, of } from 'rxjs';
import { BlogService, BlogPost } from '@beaconfolio/shared';
import { MockTranslatePipe, provideTestBrand } from '@beaconfolio/shared/testing';
import { BlogPostComponent } from './blog-post.component';
import { SeoService } from '../../../services/seo.service';
import {
  SiteConfigService,
  SiteConfig,
  DEFAULT_SITE_CONFIG,
} from '../../../services/site-config.service';

/**
 * #459 — the JSON-LD identity must come from the RESOLVED site config, whichever
 * of the two independent HTTP streams (config vs post) settles first.
 *
 * These specs drive the two streams by hand, so the ordering itself is the thing
 * under test: with a field latched by a separate `config$` subscription, the
 * post-first ordering builds the schema from `DEFAULT_SITE_CONFIG` and publishes
 * `'Portfolio Owner'` with a RELATIVE `@id` — which schema.org forbids — and
 * nothing ever corrects it.
 */

const CONFIG: SiteConfig = {
  ...DEFAULT_SITE_CONFIG,
  siteName: 'Configured Site',
  siteUrl: 'https://configured.example',
  ownerName: 'Configured Owner',
};

const POST = {
  id: 7,
  title: 'Ordered Post',
  slug: 'ordered-post',
  summary: 'Summary',
  content: 'Body',
  language: 'en',
  tags: ['seo'],
  created_at: '2026-02-01T10:00:00Z',
} as unknown as BlogPost;

interface Harness {
  fixture: ComponentFixture<BlogPostComponent>;
  config$: ReplaySubject<SiteConfig>;
  post$: ReplaySubject<BlogPost | undefined>;
  seo: { updateSeo: ReturnType<typeof vi.fn>; setJsonLd: ReturnType<typeof vi.fn>; setNotFound: ReturnType<typeof vi.fn> };
}

function setup(platform: 'browser' | 'server' = 'browser'): Harness {
  const config$ = new ReplaySubject<SiteConfig>(1);
  const post$ = new ReplaySubject<BlogPost | undefined>(1);
  const seo = { updateSeo: vi.fn(), setJsonLd: vi.fn(), setNotFound: vi.fn() };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [BlogPostComponent, MockTranslatePipe],
    providers: [
      ...provideTestBrand(),
      provideRouter([]),
      { provide: SiteConfigService, useValue: { config$: config$.asObservable() } },
      { provide: BlogService, useValue: { getPost: vi.fn().mockReturnValue(post$.asObservable()) } },
      { provide: SeoService, useValue: seo },
      { provide: PLATFORM_ID, useValue: platform },
      { provide: RESPONSE_INIT, useValue: null },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of({ get: (k: string) => (k === 'slug' ? POST.slug : null) }),
          snapshot: { paramMap: { get: () => POST.slug } },
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(BlogPostComponent);
  fixture.detectChanges();
  return { fixture, config$, post$, seo };
}

/** The one call the crawler actually sees. */
function schema(h: Harness): Record<string, any> {
  expect(h.seo.setJsonLd).toHaveBeenCalled();
  return h.seo.setJsonLd.mock.calls.at(-1)![0] as Record<string, any>;
}

describe('BlogPostComponent — JSON-LD identity vs site-config ordering (#459)', () => {
  it('uses the configured identity when the POST resolves before the config', () => {
    const h = setup();

    h.post$.next(POST);
    // The post has landed and the config has NOT. Nothing may be published yet
    // from the placeholder identity.
    expect(h.seo.setJsonLd).not.toHaveBeenCalled();

    h.config$.next(CONFIG);

    const jsonLd = schema(h);
    expect(jsonLd['author']).toEqual({
      '@type': 'Person',
      name: 'Configured Owner',
      url: 'https://configured.example',
    });
    expect(jsonLd['mainEntityOfPage']['@id']).toBe('https://configured.example/blog/ordered-post');
    // schema.org requires an absolute URI here; `DEFAULT_SITE_CONFIG.siteUrl` is ''.
    expect(new URL(jsonLd['mainEntityOfPage']['@id']).origin).toBe('https://configured.example');
    // No emission may ever carry the bundled placeholder.
    for (const [published] of h.seo.setJsonLd.mock.calls) {
      expect(published['author'].name).not.toBe(DEFAULT_SITE_CONFIG.ownerName);
    }
  });

  it('produces the identical schema when the CONFIG resolves before the post', () => {
    const configFirst = setup();
    configFirst.config$.next(CONFIG);
    expect(configFirst.seo.setJsonLd).not.toHaveBeenCalled();
    configFirst.post$.next(POST);

    const postFirst = setup();
    postFirst.post$.next(POST);
    postFirst.config$.next(CONFIG);

    expect(schema(configFirst)).toEqual(schema(postFirst));
    expect(schema(configFirst)['mainEntityOfPage']['@id']).toBe(
      'https://configured.example/blog/ordered-post'
    );
  });

  // Guard, not a pin: this case passes against the old field-latched code too —
  // it is here so the composed stream cannot start publishing a schema for a
  // post that does not exist (the combined emission carries a config either way).
  it('still resolves not-found (no schema) when the post is missing, whichever settles first', () => {
    const h = setup();
    h.post$.next(undefined);
    h.config$.next(CONFIG);

    expect(h.seo.setJsonLd).not.toHaveBeenCalled();
    expect(h.seo.setNotFound).toHaveBeenCalled();
  });

  it('waits for the resolved config before building the SSR share URL', async () => {
    const h = setup('server');
    h.post$.next(POST);

    let settled = false;
    const shared = h.fixture.componentInstance.sharePost().then(() => (settled = true));
    // Flush every pending microtask: with the identity latched in a field the
    // server branch resolves immediately (against the placeholder siteUrl).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    h.config$.next(CONFIG);
    await shared;
    expect(settled).toBe(true);
  });
});
