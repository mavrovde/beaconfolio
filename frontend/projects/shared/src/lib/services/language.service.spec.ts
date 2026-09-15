import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { LanguageService } from './language.service';
import { StorageService } from './storage.service';
import { firstValueFrom } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('LanguageService', () => {
  let service: LanguageService;
  let httpMock: HttpTestingController;
  let storageServiceMock: any;

  beforeEach(() => {
    storageServiceMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        LanguageService,
        { provide: StorageService, useValue: storageServiceMock },
      ],
    });
    service = TestBed.inject(LanguageService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should load default language on init', () => {
    const req = httpMock.expectOne('/assets/i18n/en.json');
    expect(req.request.method).toBe('GET');
    req.flush({ TEST: 'Test' });
    expect(service.getCurrentLanguage()).toBe('en');
  });

  it('should translate correctly using nested keys', async () => {
    const initReq = httpMock.expectOne('/assets/i18n/en.json');
    initReq.flush({ NAV: { LLM: 'LLM Support' } });

    const translation = await firstValueFrom(service.translate('NAV.LLM'));
    expect(translation).toBe('LLM Support');
  });

  it('should return the key if translation is missing', async () => {
    const initReq = httpMock.expectOne('/assets/i18n/en.json');
    initReq.flush({});

    const translation = await firstValueFrom(service.translate('MISSING.KEY'));
    expect(translation).toBe('MISSING.KEY');
  });

  it('should handle malformed keys gracefully', async () => {
    const initReq = httpMock.expectOne('/assets/i18n/en.json');
    initReq.flush({ A: { B: 'C' } });

    const t1 = await firstValueFrom(service.translate('A.B.D'));
    expect(t1).toBe('A.B.D');
  });

  it('should fall back to the key when it resolves to a branch node', async () => {
    const initReq = httpMock.expectOne('/assets/i18n/en.json');
    initReq.flush({ NAV: { LLM: 'LLM Support' } });

    // 'NAV' walks to the sub-tree object — must yield the key, never
    // '[object Object]' (#423, nit 7: the old cast typed the branch as string).
    const translation = await firstValueFrom(service.translate('NAV'));
    expect(translation).toBe('NAV');
  });

  it('should load translations when setting language', () => {
    const initReq = httpMock.expectOne('/assets/i18n/en.json');
    initReq.flush({});

    service.setLanguage('de');
    const deReq = httpMock.expectOne('/assets/i18n/de.json');
    deReq.flush({ TEST: 'Deutsch' });

    expect(service.getCurrentLanguage()).toBe('de');
  });

  it('should not reload if setting same language', () => {
    const initReq = httpMock.expectOne('/assets/i18n/en.json');
    initReq.flush({});

    service.setLanguage('en');
    httpMock.expectNone('/assets/i18n/en.json');
  });

  it('should persist language on setLanguage', () => {
    const initReq = httpMock.expectOne('/assets/i18n/en.json');
    initReq.flush({});

    service.setLanguage('de');
    const deReq = httpMock.expectOne('/assets/i18n/de.json');
    deReq.flush({});

    expect(storageServiceMock.setItem).toHaveBeenCalledWith('language', 'de');
  });

  it('should handle http error and return fallback', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    const initReq = httpMock.expectOne('/assets/i18n/en.json');

    // Simulate network error
    initReq.flush('Error', { status: 500, statusText: 'Server Error' });

    const translation = await firstValueFrom(service.translate('ANY_KEY'));

    expect(translation).toBe('ANY_KEY');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should return multiple results when translations change', async () => {
    const initReq = httpMock.expectOne('/assets/i18n/en.json');
    initReq.flush({ KEY: 'Initial' });

    const results: string[] = [];
    const sub = service.translate('KEY').subscribe(val => results.push(val));

    expect(results[0]).toBe('Initial');

    service.setLanguage('de');
    const deReq = httpMock.expectOne('/assets/i18n/de.json');
    deReq.flush({ KEY: 'Deutsch' });

    expect(results[1]).toBe('Deutsch');
    sub.unsubscribe();
  });
});

describe('LanguageService with saved language', () => {
  it('should initialize with saved language if valid', () => {
    const storageServiceMock = {
      getItem: vi.fn().mockReturnValue('de'),
      setItem: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        LanguageService,
        { provide: StorageService, useValue: storageServiceMock },
      ],
    });
    const localService = TestBed.inject(LanguageService);
    const localHttp = TestBed.inject(HttpTestingController);

    const req = localHttp.expectOne('/assets/i18n/de.json');
    expect(req.request.method).toBe('GET');
    req.flush({});

    expect(localService.getCurrentLanguage()).toBe('de');
    localHttp.verify();
  });

  it('should fallback to en if saved language is invalid', () => {
    const storageServiceMock = {
      getItem: vi.fn().mockReturnValue('fr'),
      setItem: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        LanguageService,
        { provide: StorageService, useValue: storageServiceMock },
      ],
    });
    const localService = TestBed.inject(LanguageService);
    const localHttp = TestBed.inject(HttpTestingController);

    localHttp.expectOne('/assets/i18n/en.json');
    expect(localService.getCurrentLanguage()).toBe('en');
    localHttp.verify();
  });
});
