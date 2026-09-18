import { ChangeDetectorRef, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HeaderComponent } from './header.component';
import { By } from '@angular/platform-browser';
import { vi, afterEach } from 'vitest';
import { Router, provideRouter } from '@angular/router';


import { LanguageService } from '@beaconfolio/shared';
import { createInInjectionContext, MockLanguageService } from '@beaconfolio/shared/testing';
import { YearsService } from '../../services/years.service';
import { of } from 'rxjs';

class MockYearsService {
  getYears() {
    return of([2025, 2024, 2021, 2014, 2009]);
  }
}

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let router: any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideRouter([]),
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: YearsService, useClass: MockYearsService },
      ],
    })
      .compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have 8 nav items', () => {
    expect(component.navItems.length).toBe(8);
  });

  it('should render navigation links', () => {
    const navLinks = fixture.debugElement.queryAll(By.css('nav a'));
    expect(navLinks.length).toBe(8);
  });

  it('should NOT have border-terminal on the header', () => {
    const terminalBorders = fixture.debugElement.queryAll(By.css('header.border-terminal'));
    expect(terminalBorders.length).toBe(0);
  });

  it('active scrollTo should prevent default behavior and navigate', () => {
    const event = new Event('click');
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    component.scrollTo('#test', event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/'], { fragment: 'test' });
  });

  it('scrollTo should navigate via router if href starts with /', () => {
    const event = new Event('click');
    component.scrollTo('/llm', event);
    expect(router.navigate).toHaveBeenCalledWith(['/llm']);
  });

  it('scrollTo should navigate even if element is not found in DOM yet', () => {
    const event = new Event('click');
    component.scrollTo('#non-existent', event);
    expect(router.navigate).toHaveBeenCalledWith(['/'], { fragment: 'non-existent' });
  });

  it('switchLanguage should call setLanguage on LanguageService', () => {
    const languageService = TestBed.inject(LanguageService);
    const setLanguageSpy = vi.spyOn(languageService, 'setLanguage');
    component.switchLanguage('de');
    expect(setLanguageSpy).toHaveBeenCalledWith('de');
  });

  it('should update currentLang when LanguageService emits new language', () => {
    const mockLangService = TestBed.inject(LanguageService) as any;
    mockLangService.setLanguage('de');
    expect(component.currentLang).toBe('de');
  });

  it('should have correct properties in navItems', () => {
    expect(component.navItems[0]).toEqual({ labelKey: 'NAV.BLOG', href: '#blog' });
    expect(component.navItems[5]).toEqual({ labelKey: 'NAV.CV', href: '/cv' });
    expect(component.navItems[component.navItems.length - 1]).toEqual({ labelKey: 'NAV.LLM', href: '/llm' });
  });

  // ─── Terminal Year Slider Tests ───

  it('should load years on init in ascending order', () => {
    expect(component.years).toEqual([2009, 2014, 2021, 2024, 2025]);
  });

  it('should have selectedYearIndex at last index (newest)', () => {
    expect(component.selectedYearIndex).toBe(4);
  });

  it('should render year slider', () => {
    fixture.changeDetectorRef.detectChanges();
    const slider = fixture.debugElement.query(By.css('.year-slider'));
    expect(slider).toBeTruthy();
  });

  it('should render year buttons in slider', () => {
    fixture.changeDetectorRef.detectChanges();
    const yearBtns = fixture.debugElement.queryAll(By.css('.slider-year'));
    expect(yearBtns.length).toBe(5);
  });

  it('should render arrow buttons', () => {
    fixture.changeDetectorRef.detectChanges();
    const arrows = fixture.debugElement.queryAll(By.css('.slider-arrow'));
    expect(arrows.length).toBe(2);
  });

  it('should highlight selected year with brackets', () => {
    fixture.changeDetectorRef.detectChanges();
    const selected = fixture.debugElement.query(By.css('.slider-year.selected'));
    expect(selected).toBeTruthy();
    expect(selected.nativeElement.textContent).toContain('[2025]');
  });

  it('absDiff should return absolute difference', () => {
    expect(component.absDiff(3, 7)).toBe(4);
    expect(component.absDiff(7, 3)).toBe(4);
    expect(component.absDiff(5, 5)).toBe(0);
  });

  it('prevYear should decrement index (go left to older year)', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    component.selectedYearIndex = 3;
    component.prevYear();
    expect(component.selectedYearIndex).toBe(2);
  });

  it('prevYear should not go below 0', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    component.selectedYearIndex = 0;
    component.prevYear();
    expect(component.selectedYearIndex).toBe(0);
  });

  it('nextYear should increment index (go right to newer year)', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    component.selectedYearIndex = 1;
    component.nextYear();
    expect(component.selectedYearIndex).toBe(2);
  });

  it('nextYear should not go beyond last index', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    component.selectedYearIndex = 4;
    component.nextYear();
    expect(component.selectedYearIndex).toBe(4);
  });

  it('selectYearByIndex should update index and scroll', fakeAsync(() => {
    const mockElement = document.createElement('div');
    vi.spyOn(mockElement, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect);
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '[data-year="2021"]') return mockElement;
      return null;
    });
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => { });

    component.selectYearByIndex(2);
    expect(component.selectedYearIndex).toBe(2);
    
    tick(500);
    expect(scrollToSpy).toHaveBeenCalled();
  }));

  it('scrollToYear should fallback to experience section', fakeAsync(() => {
    const expSection = document.createElement('section');
    vi.spyOn(expSection, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect);
    vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => {
      if (sel === '#experience') return expSection;
      return null;
    });
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => { });

    component.scrollToYear(9999);
    tick(500);
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 420, behavior: 'smooth' });
  }));

  it('scrollToYear should navigate directly and return if not in browser environment', () => {
    const langService = TestBed.inject(LanguageService);
    const yearsService = TestBed.inject(YearsService);
    // The component takes no constructor arguments since #425 — the 'server' platform is
    // expressed as a provider on a throwaway injector instead of a positional argument.
    const serverComponent = createInInjectionContext(HeaderComponent, [
      { provide: LanguageService, useValue: langService },
      { provide: YearsService, useValue: yearsService },
      { provide: Router, useValue: router },
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
    ]);
    serverComponent.scrollToYear(2020);
    expect(router.navigate).toHaveBeenCalledWith(['/'], { fragment: 'experience' });
  });

  it('should not show slider when years array is empty', () => {
    // HeaderComponent populates `years` from YearsService in its constructor, so the shared
    // fixture is already rendered with a full slider. Mutating `component.years = []` after
    // that first render and re-running change detection does not re-render the frozen fixture
    // view under the Angular 22 test harness. Build a fresh fixture whose YearsService yields
    // an empty list to assert the real behaviour: `@if (years.length > 0)` hides the slider.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideRouter([]),
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: YearsService, useValue: { getYears: () => of([]) } },
      ],
    });
    const emptyFixture = TestBed.createComponent(HeaderComponent);
    emptyFixture.detectChanges();
    const slider = emptyFixture.debugElement.query(By.css('.year-slider'));
    expect(slider).toBeFalsy();
    expect(emptyFixture.componentInstance.years).toEqual([]);
  });
});
