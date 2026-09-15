import { TestBed } from '@angular/core/testing';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { of } from 'rxjs';
import { OG_IMAGE_PATH, SeoService } from './seo.service';
import { DEFAULT_SITE_CONFIG, SiteConfigService } from './site-config.service';
import { Title, Meta } from '@angular/platform-browser';

/** The neutral fallback identity — notably `siteUrl: ''`. */
const NEUTRAL_CONFIG = DEFAULT_SITE_CONFIG;

const MOCK_SITE_CONFIG_PROVIDER = {
  provide: SiteConfigService,
  useValue: {
    config$: of({
      siteName: 'beaconfolio.com',
      siteUrl: 'https://beaconfolio.com',
      ownerName: 'Mock Owner',
      ownerHeadline: 'Principal Software Engineer',
      ownerDescription: 'Desc.',
     
      socialLinks: [],
      analyticsId: '',
    }),
  },
};

describe('SeoService canonical URL handling', () => {
  afterEach(() => {
    document.querySelectorAll("link[rel='canonical']").forEach((l) => l.remove());
  });

  it('creates then reuses the canonical link', () => {
    TestBed.configureTestingModule({
      providers: [SeoService, Title, Meta, MOCK_SITE_CONFIG_PROVIDER],
    });
    const service = TestBed.inject(SeoService);

    service.updateSeo({ url: '/first' });
    const link = document.querySelector("link[rel='canonical']") as HTMLLinkElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('https://beaconfolio.com/first');

    // Second call should reuse the existing link element (else-branch not taken)
    service.updateSeo({ url: '/second' });
    const links = document.querySelectorAll("link[rel='canonical']");
    expect(links.length).toBe(1);
    expect((links[0] as HTMLLinkElement).getAttribute('href')).toBe('https://beaconfolio.com/second');
  });

  /**
   * REPLACES "skips canonical update on server platform" (#71): the platform is
   * no longer what decides. What decides is whether an ABSOLUTE URL can be
   * built at all — before the runtime config arrives (or when the backend is
   * unreachable) `siteUrl` is empty, and a canonical/og:url of "" is worse than
   * none.
   */
  it('emits no canonical, og:url or og:image while the site URL is unknown', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SeoService,
        Title,
        Meta,
        { provide: SiteConfigService, useValue: { config$: of({ ...NEUTRAL_CONFIG }) } },
      ],
    });
    const meta = TestBed.inject(Meta);
    const updateTag = vi.spyOn(meta, 'updateTag');

    TestBed.inject(SeoService).updateSeo({ url: '/anything' });

    expect(document.querySelector("link[rel='canonical']")).toBeNull();
    for (const selector of [
      { property: 'og:url' },
      { property: 'og:image' },
      { name: 'twitter:image' },
    ]) {
      expect(updateTag).not.toHaveBeenCalledWith(expect.objectContaining(selector));
    }
    // The identity-only tags still go out — only the URL-derived ones wait.
    expect(updateTag).toHaveBeenCalledWith({ property: 'og:type', content: 'website' });
  });

  it('derives og:image and twitter:image from the configured site URL', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [SeoService, Title, Meta, MOCK_SITE_CONFIG_PROVIDER],
    });
    const meta = TestBed.inject(Meta);
    const updateTag = vi.spyOn(meta, 'updateTag');

    TestBed.inject(SeoService).updateSeo({});

    const card = `https://beaconfolio.com${OG_IMAGE_PATH}`;
    expect(updateTag).toHaveBeenCalledWith({ property: 'og:image', content: card });
    expect(updateTag).toHaveBeenCalledWith({ name: 'twitter:image', content: card });
    expect(updateTag).toHaveBeenCalledWith({ property: 'og:url', content: 'https://beaconfolio.com/' });
  });

  it('prefers an explicitly supplied image over the default card', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [SeoService, Title, Meta, MOCK_SITE_CONFIG_PROVIDER],
    });
    const meta = TestBed.inject(Meta);
    const updateTag = vi.spyOn(meta, 'updateTag');

    TestBed.inject(SeoService).updateSeo({ image: '/assets/images/post.png' });

    expect(updateTag).toHaveBeenCalledWith({
      property: 'og:image',
      content: 'https://beaconfolio.com/assets/images/post.png',
    });
  });
});
