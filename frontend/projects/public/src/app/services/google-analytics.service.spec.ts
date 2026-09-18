import { TestBed } from '@angular/core/testing';
import { GoogleAnalyticsService } from './google-analytics.service';
import { SiteConfigService } from './site-config.service';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { PLATFORM_ID } from '@angular/core';

// The measurement id now arrives via the runtime site config (#65).
const MOCK_SITE_CONFIG_PROVIDER = {
  provide: SiteConfigService,
  useValue: {
    config$: of({
      siteName: 'beaconfolio.com', siteUrl: 'https://beaconfolio.com',
      ownerName: 'Mock Owner', ownerHeadline: 'Principal Software Engineer',
      ownerDescription: 'Desc.', socialLinks: [],
      analyticsId: 'G-TESTID0042',
    }),
  },
};

describe('GoogleAnalyticsService', () => {
  let service: GoogleAnalyticsService;
    let routerEventsSubject: Subject<any>;

  beforeEach(() => {
    routerEventsSubject = new Subject<any>();
    const routerMock = {
      events: routerEventsSubject.asObservable(),
    };

    TestBed.configureTestingModule({
      providers: [GoogleAnalyticsService, { provide: Router, useValue: routerMock }, MOCK_SITE_CONFIG_PROVIDER],
    });
    service = TestBed.inject(GoogleAnalyticsService);

    // Mock window.gtag
    Object.defineProperty(window, 'gtag', {
      value: vi.fn(),
      writable: true
    });

    // Prevent script execution in JSDOM for all tests by mocking appendChild
    vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => node);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ['google-analytics-script', 'google-analytics-init'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    const gtm = document.getElementById('gtm-container-script');
    if (gtm) gtm.remove();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialize Google Analytics script', () => {
    const createElementSpy = vi.spyOn(document, 'createElement');
    const appendChildSpy = vi.spyOn(document.head, 'appendChild');

    service.initialize();

    expect(createElementSpy).toHaveBeenCalledWith('script');
    expect(appendChildSpy).toHaveBeenCalled();

    // Verify script content contains correct ID
    const appendedScript = appendChildSpy.mock.calls[1][0] as HTMLScriptElement;
    expect(appendedScript.innerHTML).toContain('G-TESTID0042');
    expect(appendedScript.innerHTML).toContain("gtag('js', new Date());");
  });

  it('should track page views on navigation end', () => {
    service.initialize(); // Initialize to set up subscription

    const navigationEnd = new NavigationEnd(1, '/test-url', '/test-url');
    routerEventsSubject.next(navigationEnd);

    expect((window as any).gtag).toHaveBeenCalledWith('config', 'G-TESTID0042', {
      page_path: '/test-url',
    });
  });

  it('should not throw if gtag is undefined during navigation', () => {
    service.initialize();

    // Unset gtag
    (window as any).gtag = undefined;

    const navigationEnd = new NavigationEnd(1, '/test-url', '/test-url');
    // Should not throw
    routerEventsSubject.next(navigationEnd);
  });

  it('should not initialize on server platform', () => {
    // Re-configure for server platform
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        GoogleAnalyticsService,
        { provide: Router, useValue: { events: new Subject() } },
        { provide: PLATFORM_ID, useValue: 'server' },
        MOCK_SITE_CONFIG_PROVIDER
      ]
    });
    const serverService = TestBed.inject(GoogleAnalyticsService);
    // Spy again because TestBed reset might rely on fresh injectors, but document is global.
    // However, vi.restoreAllMocks() in afterEach removes the spy. 
    // We need to re-spy or rely on proper cleanup.
    // Since we restore mocks in afterEach, we must re-spy here or remove restoreAllMocks.
    const appendChildSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => node);

    serverService.initialize();

    expect(appendChildSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed analytics id — nothing may smuggle markup into the inline script', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        GoogleAnalyticsService,
        { provide: Router, useValue: { events: new Subject() } },
        {
          provide: SiteConfigService,
          useValue: {
            config$: of({
              siteName: 's', siteUrl: 'u', ownerName: 'o', ownerHeadline: 'h',
              ownerDescription: 'd', socialLinks: [],
              analyticsId: 'G-1\'});alert(1);//',
            }),
          },
        },
      ]
    });
    const svc = TestBed.inject(GoogleAnalyticsService);
    const appendChildSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => node);

    svc.initialize();

    expect(appendChildSpy).not.toHaveBeenCalled();
    expect((svc as any).googleAnalyticsId).toBe('');
  });

  it('should not initialize when the config carries an empty analytics id (#65 disabled state)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        GoogleAnalyticsService,
        { provide: Router, useValue: { events: new Subject() } },
        {
          provide: SiteConfigService,
          useValue: {
            config$: of({
              siteName: 's', siteUrl: 'u', ownerName: 'o', ownerHeadline: 'h',
              ownerDescription: 'd', socialLinks: [],
              analyticsId: '',
            }),
          },
        },
      ]
    });
    const disabledService = TestBed.inject(GoogleAnalyticsService);
    const appendChildSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => node);

    disabledService.initialize();

    expect(appendChildSpy).not.toHaveBeenCalled();
    expect((disabledService as any).isInitialized).toBe(false);
  });

  it('should return early if scripts already exist', () => {
    // Reset state for this test
    (service as any).isInitialized = false;

    // Mock getElementById to simulate scripts already existing in DOM
    const getSpy = vi.spyOn(document, 'getElementById').mockReturnValue({} as HTMLElement);
    const appendChildSpy = vi.spyOn(document.head, 'appendChild');

    service.initialize();

    expect(appendChildSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });

  it('should return early from loadScript/initGtag if elements exist by ID', () => {
    // Reset state
    (service as any).isInitialized = false;

    // Mock getElementById to return something for both script IDs
    const getSpy = vi.spyOn(document, 'getElementById').mockImplementation((id: string) => {
      if (id === 'google-analytics-script' || id === 'google-analytics-init') {
        return {} as HTMLElement;
      }
      return null;
    });

    const appendChildSpy = vi.spyOn(document.head, 'appendChild');
    service.initialize();

    expect(appendChildSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });
});


// --- GTM container install (#447) ---

import { firstValueFrom } from 'rxjs';
import { safeTagId } from './google-analytics.service';

/** Build a service whose site config carries the given fields. */
function serviceWith(cfg: Record<string, unknown>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      GoogleAnalyticsService,
      { provide: Router, useValue: { events: new Subject<any>().asObservable() } },
      {
        provide: SiteConfigService,
        useValue: {
          config$: of({
            siteName: 's', siteUrl: '', ownerName: 'o', ownerHeadline: 'h',
            ownerDescription: 'd', socialLinks: [], analyticsId: '',
            gtmContainerId: '', ...cfg,
          }),
        },
      },
    ],
  });
  return TestBed.inject(GoogleAnalyticsService);
}

describe('GoogleAnalyticsService — GTM (#447)', () => {
  let appended: Node[];

  beforeEach(() => {
    appended = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
      appended.push(node);
      return node;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ['google-analytics-script', 'google-analytics-init', 'gtm-container-script']
      .forEach(id => document.getElementById(id)?.remove());
  });

  const srcs = () => appended
    .filter((n): n is HTMLScriptElement => (n as HTMLScriptElement).tagName === 'SCRIPT')
    .map(n => (n as HTMLScriptElement).src || '');

  it('installs the container via the canonical gtm.js loader', () => {
    serviceWith({ gtmContainerId: 'GTM-ABC1234' }).initialize();
    expect(srcs().some(u => u === 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234'))
      .toBe(true);
  });

  it('seeds dataLayer with the gtm.start event', () => {
    (window as any).dataLayer = undefined;
    serviceWith({ gtmContainerId: 'GTM-ABC1234' }).initialize();
    const dl = (window as any).dataLayer as any[];
    expect(dl.some(e => e && e.event === 'gtm.js' && typeof e['gtm.start'] === 'number'))
      .toBe(true);
  });

  // The DISCRIMINATING case. Two installs of one measurement double-count
  // every pageview, so "GTM wins" has to mean gtag is SKIPPED, not reordered.
  it('does NOT also install gtag when both ids are configured', () => {
    serviceWith({ gtmContainerId: 'GTM-ABC1234', analyticsId: 'G-SHOULDNOT' }).initialize();
    expect(srcs().some(u => u.includes('/gtm.js?id=GTM-ABC1234'))).toBe(true);
    expect(srcs().some(u => u.includes('/gtag/js'))).toBe(false);
    expect(document.getElementById('google-analytics-init')).toBeNull();
  });

  it('falls back to the gtag install when no container is configured', () => {
    serviceWith({ analyticsId: 'G-ONLYGTAG' }).initialize();
    expect(srcs().some(u => u.includes('/gtag/js?id=G-ONLYGTAG'))).toBe(true);
    expect(srcs().some(u => u.includes('/gtm.js'))).toBe(false);
  });

  it('installs nothing when neither id is configured', () => {
    serviceWith({}).initialize();
    expect(srcs()).toEqual([]);
  });

  it('drops a container id that could smuggle markup', () => {
    serviceWith({ gtmContainerId: 'GTM-X"></script><script>alert(1)' }).initialize();
    expect(srcs()).toEqual([]);
  });

  it('exposes the <noscript> url only when a container is configured', async () => {
    const withGtm = serviceWith({ gtmContainerId: 'GTM-ABC1234' });
    expect(await firstValueFrom(withGtm.gtmNoscriptUrl$)).not.toBeNull();

    const without = serviceWith({});
    expect(await firstValueFrom(without.gtmNoscriptUrl$)).toBeNull();
  });

  // Regression: a pre-#447 backend omits gtm_container_id entirely. Without
  // the typeof guard, TAG_ID_PATTERN.test(undefined) tests the STRING
  // "undefined" — pure letters, so it MATCHES — and the noscript iframe would
  // point at ns.html?id=undefined.
  it('treats a MISSING container id as absent, not as the string "undefined"', async () => {
    const svc = serviceWith({ gtmContainerId: undefined });
    expect(await firstValueFrom(svc.gtmNoscriptUrl$)).toBeNull();
    svc.initialize();
    expect(srcs().some(u => u.includes('undefined'))).toBe(false);
  });

  // The idempotence guard. initialize() is called from AppComponent.ngOnInit,
  // and a second container script would push a SECOND gtm.start onto dataLayer
  // and load the container twice — the same double-count this issue exists to
  // prevent, arriving by a different route.
  it('does not install the container twice when the script is already present', () => {
    const existing = document.createElement('script');
    existing.id = 'gtm-container-script';
    document.head.insertAdjacentElement('beforeend', existing);
    try {
      serviceWith({ gtmContainerId: 'GTM-ABC1234' }).initialize();
      expect(srcs().some(u => u.includes('/gtm.js'))).toBe(false);
    } finally {
      existing.remove();
    }
  });

  it('safeTagId rejects every non-string and every unsafe string', () => {
    expect(safeTagId(undefined)).toBe('');
    expect(safeTagId(null)).toBe('');
    expect(safeTagId(42)).toBe('');
    expect(safeTagId('')).toBe('');
    expect(safeTagId('GTM-OK123')).toBe('GTM-OK123');
    expect(safeTagId('GTM OK')).toBe('');
  });
});
