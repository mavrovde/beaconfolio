import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LanguageService } from '@beaconfolio/shared';
import { MockLanguageService } from '@beaconfolio/shared/testing';
import { Profile, ProfileService, decodeProfileText } from './profile.service';

describe('decodeProfileText', () => {
    it('decodes every string, through arrays and nested objects, leaving other values alone', () => {
        expect(
            decodeProfileText({
                about: 'Engineer &amp; Architect',
                skills: ['AI &amp; MCP', 'Go'],
                experience: [{ company: 'A &amp; B', startDate: '2020' }],
                count: 3,
                flag: true,
                missing: null,
            }),
        ).toEqual({
            about: 'Engineer & Architect',
            skills: ['AI & MCP', 'Go'],
            experience: [{ company: 'A & B', startDate: '2020' }],
            count: 3,
            flag: true,
            missing: null,
        });
    });
});

describe('ProfileService — SEO inputs', () => {
    let service: ProfileService;
    let http: HttpTestingController;

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
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('serves the profile text decoded — the root of the live &amp;amp; description', () => {
        let received: Profile | undefined;
        service.getProfile().subscribe((profile) => (received = profile));
        http.expectOne((r) => r.url.endsWith('/profile?lang=en')).flush({
            name: 'Jane Doe',
            about: 'Principal Software Engineer &amp; Architect',
        });
        expect(received?.about).toBe('Principal Software Engineer & Architect');
    });

    it('reads the profile lastModified from the JSON Resume meta', () => {
        let received: string | null | undefined;
        service.getLastModified().subscribe((value) => (received = value));
        http.expectOne((r) => r.url.endsWith('/profile/resume.json?lang=en')).flush({
            meta: { lastModified: '2026-09-10T11:46:15+00:00' },
        });
        expect(received).toBe('2026-09-10T11:46:15+00:00');
    });

    it.each([[{ meta: { lastModified: null } }], [{}], [null]])('is null for %j', (body) => {
        let received: string | null | undefined;
        service.getLastModified().subscribe((value) => (received = value));
        http.expectOne((r) => r.url.includes('/profile/resume.json')).flush(body);
        expect(received).toBeNull();
    });

    it('is null — never "now" — when the request fails', () => {
        let received: string | null | undefined = 'unset';
        service.getLastModified().subscribe((value) => (received = value));
        http.expectOne((r) => r.url.includes('/profile/resume.json')).flush('boom', {
            status: 500,
            statusText: 'Server Error',
        });
        expect(received).toBeNull();
    });
});
