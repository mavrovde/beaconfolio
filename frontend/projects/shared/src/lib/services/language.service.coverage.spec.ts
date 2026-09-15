import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { LanguageService } from './language.service';
import { StorageService } from './storage.service';

describe('LanguageService saved language branch', () => {
  let httpMock: HttpTestingController;

  function configure(saved: string | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        LanguageService,
        {
          provide: StorageService,
          useValue: {
            getItem: (_k: string) => saved,
            setItem: () => {},
          },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(LanguageService);
  }

  afterEach(() => httpMock.verify());

  it('loads saved language (de) from storage on init (lines 23-24)', () => {
    const service = configure('de');
    expect(service.getCurrentLanguage()).toBe('de');
    const req = httpMock.expectOne('/assets/i18n/de.json');
    req.flush({ HELLO: 'Hallo' });
  });

  it('falls back to en when saved value is invalid', () => {
    const service = configure('fr');
    expect(service.getCurrentLanguage()).toBe('en');
    const req = httpMock.expectOne('/assets/i18n/en.json');
    req.flush({ HELLO: 'Hi' });
  });
});
