import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  ProfileService,
  Profile,
  Certification,
  displayCertification,
  normalizeProfile,
} from './profile.service';
import { LanguageService } from '@beaconfolio/shared';
import { MockLanguageService } from '@beaconfolio/shared/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ProfileService', () => {
  let service: ProfileService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProfileService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LanguageService, useClass: MockLanguageService },
      ],
    });
    service = TestBed.inject(ProfileService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  const dummyProfile: Profile = {
    name: 'John Doe',
    headline: 'Developer',
    location: 'City',
    about: 'Bio',
    contact: { email: 'test@example.com', linkedin: 'https://linkedin.com/test' },
    experience: [],
    education: [],
    skills: ['Angular'],
    certifications: [],
    languages: [],
    recommendations: [],
  };

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch the active profile from the backend', () => {
    service.getProfile().subscribe((profile) => {
      expect(profile).toEqual(dummyProfile);
    });

    const req = httpMock.expectOne((r) => r.url.includes('/api/app/profile') && r.method === 'GET');
    expect(req.request.url).toContain('lang=en');
    req.flush(dummyProfile);
  });

  it('should fall back to the static asset when the backend has no profile', () => {
    service.getProfile().subscribe((profile) => {
      expect(profile).toEqual(dummyProfile);
    });

    // Backend returns 404 (no active version) → fall back to the asset.
    const backendReq = httpMock.expectOne((r) => r.url.includes('/api/app/profile'));
    backendReq.flush('Not found', { status: 404, statusText: 'Not Found' });

    const assetReq = httpMock.expectOne((r) => r.url.includes('assets/profile_data_en.json'));
    assetReq.flush(dummyProfile);
  });

  it('should error only when both backend and the asset fail', () => {
    let errorOccurred = false;
    service.getProfile().subscribe({
      next: () => {},
      error: () => {
        errorOccurred = true;
      },
    });

    httpMock
      .expectOne((r) => r.url.includes('/api/app/profile'))
      .flush('err', { status: 500, statusText: 'Server Error' });
    httpMock
      .expectOne((r) => r.url.includes('assets/profile_data_en.json'))
      .flush('err', { status: 500, statusText: 'Server Error' });

    expect(errorOccurred).toBe(true);
  });

  it('should switch language and reload profile from the backend', () => {
    const languageService = TestBed.inject(LanguageService) as unknown as MockLanguageService;

    service.getProfile().subscribe();
    httpMock.match((r) => r.url.includes('lang=en')).forEach((r) => r.flush(dummyProfile));

    languageService.setLanguage('de');

    service.getProfile().subscribe();
    const deReqs = httpMock.match((r) => r.url.includes('lang=de'));
    expect(deReqs.length).toBeGreaterThan(0);
    deReqs[0].flush({ ...dummyProfile, name: 'German Profile' });
  });

  it('should render backend certifications dated, in the order the backend sent', () => {
    const raw: Profile = {
      ...dummyProfile,
      certifications: [
        { name: 'New', issuer: 'X', issueDate: 'Okt 2026' },
        { name: 'Old', issuer: 'X', issueDate: 'Jan 2024' },
        { name: 'Demo', issuer: 'X', date: '2023' },
      ],
    };
    // Capture, flush, THEN assert: an expect inside `subscribe` throws into
    // RxJS rather than failing the test, and passes when nothing emits.
    let emitted: Profile | undefined;
    service.getProfile().subscribe((profile) => {
      emitted = profile;
    });
    httpMock.expectOne((r) => r.url.includes('/api/app/profile')).flush(raw);

    expect(emitted).toBeDefined();
    expect(emitted?.certifications?.map((c) => [c.name, c.date])).toEqual([
      ['New', 'Okt 2026'],
      ['Old', 'Jan 2024'],
      ['Demo', '2023'],
    ]);
  });
});

describe('displayCertification', () => {
  const cert = (issueDate?: string, date?: string): Certification => ({
    name: 'C',
    issuer: 'I',
    issueDate,
    date,
  });

  it('copies the scraper issueDate into date', () => {
    expect(displayCertification(cert('Sep 2026')).date).toBe('Sep 2026');
  });

  it('keeps a date the demo profile wrote directly', () => {
    expect(displayCertification(cert(undefined, '2025')).date).toBe('2025');
  });

  it('prefers an explicit date when an entry carries BOTH', () => {
    // Pins the precedence: the backend orders by `date || issueDate` too.
    expect(displayCertification(cert('Sep 2026', '2025')).date).toBe('2025');
  });

  it('renders an undated entry with an empty date', () => {
    expect(displayCertification(cert()).date).toBe('');
  });

  it('does not mutate its input', () => {
    const input = cert('Jan 2020');
    displayCertification(input);
    expect(input.date).toBeUndefined();
  });
});

describe('normalizeProfile', () => {
  it('passes a profile without certifications through unchanged', () => {
    const profile = { name: 'N' } as Profile;
    expect(normalizeProfile(profile)).toBe(profile);
  });

  it('never reorders certifications (the backend owns the order)', () => {
    const profile = {
      name: 'N',
      certifications: [
        { name: 'old', issuer: 'I', issueDate: 'Jan 2020' },
        { name: 'new', issuer: 'I', issueDate: 'Jan 2026' },
      ],
    } as Profile;
    expect(normalizeProfile(profile).certifications?.map((c) => c.name)).toEqual(['old', 'new']);
  });
});
