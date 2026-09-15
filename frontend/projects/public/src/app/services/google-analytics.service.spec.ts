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
