import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  ProfileService,
  Profile,
  Certification,
  certificationDateKey,
  normalizeProfile,
  sortCertificationsNewestFirst,
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

  it('should render backend certifications dated and newest first', () => {
    const raw: Profile = {
      ...dummyProfile,
      certifications: [
        { name: 'Old', issuer: 'X', issueDate: 'Jan 2024' },
        { name: 'New', issuer: 'X', issueDate: 'Sep 2026' },
      ],
    };
    service.getProfile().subscribe((profile) => {
      expect(profile.certifications?.map((c) => [c.name, c.date])).toEqual([
        ['New', 'Sep 2026'],
        ['Old', 'Jan 2024'],
      ]);
    });
    httpMock.expectOne((r) => r.url.includes('/api/app/profile')).flush(raw);
  });
});

describe('certificationDateKey', () => {
  it.each([
    ['Sep 2026', 2026 * 12 + 8],
    ['sept. 2026', 2026 * 12 + 8],
    ['January 2024', 2024 * 12],
    ['2026', 2026 * 12],
    ['2026-09', 2026 * 12 + 8],
    ['2026-09-18', 2026 * 12 + 8],
    ['  Dec 2020 ', 2020 * 12 + 11],
  ])('parses %j', (text, expected) => {
    expect(certificationDateKey(text)).toBe(expected);
  });

  it.each([[''], [undefined], ['soon'], ['Foo 2026'], ['26']])('rejects %j', (text) => {
    expect(certificationDateKey(text)).toBeNull();
  });
});

describe('sortCertificationsNewestFirst', () => {
  const cert = (name: string, issueDate?: string, date?: string): Certification => ({
    name,
    issuer: 'I',
    issueDate,
    date,
  });

  it('orders newest first and puts undated entries last', () => {
    const sorted = sortCertificationsNewestFirst([
      cert('undated-a'),
      cert('2023', 'Nov 2023'),
      cert('2026-sep', 'Sep 2026'),
      cert('undated-b', ''),
      cert('2026-aug', 'Aug 2026'),
      cert('year-only', '2025'),
    ]);
    expect(sorted.map((c) => c.name)).toEqual([
      '2026-sep',
      '2026-aug',
      'year-only',
      '2023',
      'undated-a',
      'undated-b',
    ]);
  });

  it('keeps the upload order within the same month (stable)', () => {
    const sorted = sortCertificationsNewestFirst([
      cert('first', 'Aug 2026'),
      cert('newer', 'Sep 2026'),
      cert('second', 'Aug 2026'),
      cert('third', 'Aug 2026'),
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['newer', 'first', 'second', 'third']);
  });

  it('copies issueDate into date, and prefers an explicit date', () => {
    const [a, b] = sortCertificationsNewestFirst([
      cert('scraped', 'Sep 2026'),
      cert('demo', undefined, '2025'),
    ]);
    expect(a.date).toBe('Sep 2026');
    expect(b.date).toBe('2025');
  });

  it('does not mutate its input', () => {
    const input = [cert('a', 'Jan 2020'), cert('b', 'Jan 2021')];
    sortCertificationsNewestFirst(input);
    expect(input.map((c) => c.name)).toEqual(['a', 'b']);
    expect(input[0].date).toBeUndefined();
  });
});

describe('normalizeProfile', () => {
  it('passes a profile without certifications through unchanged', () => {
    const profile = { name: 'N' } as Profile;
    expect(normalizeProfile(profile)).toBe(profile);
  });
});
