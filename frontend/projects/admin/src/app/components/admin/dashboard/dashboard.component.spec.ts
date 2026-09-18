import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardComponent } from './dashboard.component';
import { SiteSettingsService, THEME_PRESETS } from '../../../services/site-settings.service';
import { StatsService, SystemStats } from '@beaconfolio/shared';
import { of, throwError } from 'rxjs';
import { RouterTestingModule } from '@angular/router/testing';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let statsServiceSpy: { getStats: Mock };
  let siteSettingsSpy: {
    getAvailability: Mock;
    setAvailability: Mock;
    getTheme: Mock;
    setTheme: Mock;
  };

  const mockStats: SystemStats = {
    posts: {
      total: 10,
      published: 8,
      drafts: 2,
      by_language: { en: 5, de: 5 },
    },
    users: 1,
    subscribers: 0,
    visitors: '0',
    top_tags: { angular: 5 },
    recent_posts: [],
    system_health: {
      database: true,
      ai_service: true,
    },
  };

  beforeEach(async () => {
    statsServiceSpy = { getStats: vi.fn() };
    siteSettingsSpy = {
      getAvailability: vi.fn().mockReturnValue(of({ value: 'listening' })),
      setAvailability: vi.fn(),
      getTheme: vi.fn().mockReturnValue(of({ value: 'terminal' })),
      setTheme: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [
        { provide: StatsService, useValue: statsServiceSpy },
        { provide: SiteSettingsService, useValue: siteSettingsSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    statsServiceSpy.getStats.mockReturnValue(of(mockStats));
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should load stats correctly', () => {
    statsServiceSpy.getStats.mockReturnValue(of(mockStats));
    fixture.detectChanges();

    expect(component.stats).toEqual(mockStats);
    expect(component.loading).toBe(false);
    expect(component.error).toBeNull();
  });

  it('should handle error when loading stats', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    statsServiceSpy.getStats.mockReturnValue(throwError(() => new Error('Network error')));
    fixture.detectChanges();

    expect(component.stats).toBeNull();
    expect(component.loading).toBe(false);
    expect(component.error).toContain('Failed to load');
    expect(consoleSpy).toHaveBeenCalledWith('Dashboard: Failed to load stats:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('should return empty languages if stats are null', () => {
    component.stats = null;
    expect(component.getLanguages()).toEqual([]);
  });

  it('should return empty languages if by_language is missing', () => {
    component.stats = { posts: {} } as any;
    expect(component.getLanguages()).toEqual([]);
  });
});

describe('DashboardComponent — availability (#271)', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let siteSettingsSpy: {
    getAvailability: Mock;
    setAvailability: Mock;
    getTheme: Mock;
    setTheme: Mock;
  };

  beforeEach(async () => {
    siteSettingsSpy = {
      getAvailability: vi.fn().mockReturnValue(of({ value: 'listening' })),
      setAvailability: vi.fn(),
      getTheme: vi.fn().mockReturnValue(of({ value: 'terminal' })),
      setTheme: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [
        { provide: StatsService, useValue: { getStats: vi.fn().mockReturnValue(of(null)) } },
        { provide: SiteSettingsService, useValue: siteSettingsSpy },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads the current state on init', () => {
    expect(component.availability).toBe('listening');
  });

  it('surfaces a load failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    siteSettingsSpy.getAvailability.mockReturnValue(throwError(() => new Error('boom')));
    component.loadAvailability();
    expect(component.availabilityError).toBe('Failed to load availability');
  });

  it('saves a new state and reflects the server value', () => {
    siteSettingsSpy.setAvailability.mockReturnValue(of({ value: 'open' }));
    component.setAvailability('open');
    expect(siteSettingsSpy.setAvailability).toHaveBeenCalledWith('open');
    expect(component.availability).toBe('open');
    expect(component.availabilitySaving).toBe(false);
  });

  it('rolls back on a failed save so the control never lies', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    siteSettingsSpy.setAvailability.mockReturnValue(throwError(() => new Error('no')));
    component.setAvailability('open');
    expect(component.availability).toBe('listening');
    expect(component.availabilityError).toBe('Failed to save availability');
    expect(component.availabilitySaving).toBe(false);
  });

  it('ignores a no-op click and a click while saving', () => {
    component.setAvailability('listening');
    component.availabilitySaving = true;
    component.setAvailability('open');
    expect(siteSettingsSpy.setAvailability).not.toHaveBeenCalled();
  });
});

describe('DashboardComponent — theme (#339)', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let siteSettingsSpy: {
    getAvailability: Mock;
    setAvailability: Mock;
    getTheme: Mock;
    setTheme: Mock;
  };

  beforeEach(async () => {
    siteSettingsSpy = {
      getAvailability: vi.fn().mockReturnValue(of({ value: 'listening' })),
      setAvailability: vi.fn(),
      getTheme: vi.fn().mockReturnValue(of({ value: 'terminal' })),
      setTheme: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [
        { provide: StatsService, useValue: { getStats: vi.fn().mockReturnValue(of(null)) } },
        { provide: SiteSettingsService, useValue: siteSettingsSpy },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads the current preset on init', () => {
    expect(component.theme).toBe('terminal');
  });

  // The picker is the ONLY way a preset can be chosen, so a preset missing
  // from it is a preset nobody can select — the acceptance criterion is that
  // all five are switchable from the admin panel.
  it('offers a button for every preset in the vocabulary', () => {
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="theme-panel"] button')
    ).map((b) => (b as HTMLElement).textContent!.trim());
    expect(labels).toEqual([...THEME_PRESETS]);
  });

  it('marks the active preset for assistive tech, not only by colour', () => {
    const pressed = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="theme-panel"] button')
    ).filter((b) => (b as HTMLElement).getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect((pressed[0] as HTMLElement).textContent!.trim()).toBe('terminal');
  });

  it('surfaces a load failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    siteSettingsSpy.getTheme.mockReturnValue(throwError(() => new Error('boom')));
    component.loadTheme();
    expect(component.themeError).toBe('Failed to load theme');
  });

  it('saves a new preset and reflects the server value', () => {
    siteSettingsSpy.setTheme.mockReturnValue(of({ value: 'classic' }));
    component.setTheme('classic');
    expect(siteSettingsSpy.setTheme).toHaveBeenCalledWith('classic');
    expect(component.theme).toBe('classic');
    expect(component.themeSaving).toBe(false);
  });

  it('rolls back on a failed save so the control never lies', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    siteSettingsSpy.setTheme.mockReturnValue(throwError(() => new Error('no')));
    component.setTheme('light');
    expect(component.theme).toBe('terminal');
    expect(component.themeError).toBe('Failed to save theme');
    expect(component.themeSaving).toBe(false);
  });

  it('ignores a no-op click and a click while saving', () => {
    component.setTheme('terminal');
    component.themeSaving = true;
    component.setTheme('light');
    expect(siteSettingsSpy.setTheme).not.toHaveBeenCalled();
  });
});
