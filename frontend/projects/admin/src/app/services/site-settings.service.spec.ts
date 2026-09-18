import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
    HttpTestingController,
    provideHttpClientTesting,
} from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SiteSettingsService, THEME_DESCRIPTIONS, THEME_PRESETS } from './site-settings.service';
import { environment } from '../../environments/environment';

describe('SiteSettingsService', () => {
    let service: SiteSettingsService;
    let httpMock: HttpTestingController;
    const base = `${environment.apiUrl}${environment.apiPrefix}/admin/site-settings`;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting(), SiteSettingsService],
        });
        service = TestBed.inject(SiteSettingsService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('reads and writes the availability state', () => {
        service.getAvailability().subscribe();
        httpMock.expectOne(`${base}/availability`).flush({ value: 'listening' });

        service.setAvailability('open').subscribe();
        const put = httpMock.expectOne(`${base}/availability`);
        expect(put.request.method).toBe('PUT');
        expect(put.request.body).toEqual({ value: 'open' });
        put.flush({ value: 'open' });
    });

    it('reads and writes the theme preset', () => {
        service.getTheme().subscribe();
        httpMock.expectOne(`${base}/theme`).flush({ value: 'terminal' });

        service.setTheme('classic').subscribe();
        const put = httpMock.expectOne(`${base}/theme`);
        expect(put.request.method).toBe('PUT');
        expect(put.request.body).toEqual({ value: 'classic' });
        put.flush({ value: 'classic' });
    });

    // The picker renders `THEME_DESCRIPTIONS[preset]` under the selection. A
    // preset added to the vocabulary without a description renders an empty
    // paragraph, which reads as a rendering bug rather than as a missing
    // string — so the two lists are pinned to each other here.
    it('describes every preset it offers', () => {
        for (const preset of THEME_PRESETS) {
            expect(THEME_DESCRIPTIONS[preset], preset).toBeTruthy();
        }
        expect(Object.keys(THEME_DESCRIPTIONS).sort()).toEqual([...THEME_PRESETS].sort());
    });
});
