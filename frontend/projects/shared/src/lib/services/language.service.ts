import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map, catchError, shareReplay } from 'rxjs/operators';
import { StorageService } from './storage.service';

export type Language = 'en' | 'de';

/** Nested i18n catalog: leaves are strings, branches nest. */
export type TranslationTree = { [key: string]: string | TranslationTree };

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  private currentLangSubject = new BehaviorSubject<Language>('en');
  currentLang$ = this.currentLangSubject.asObservable();

  private translationsSubject = new BehaviorSubject<TranslationTree>({});
  translations$ = this.translationsSubject.asObservable();

  constructor(private http: HttpClient, private storageService: StorageService) {
    // Try to load saved language if exists (and consented)
    const savedLang = this.storageService.getItem('language') as Language;
    if (savedLang && (savedLang === 'en' || savedLang === 'de')) {
      this.currentLangSubject.next(savedLang);
      this.loadTranslations(savedLang);
    } else {
      this.loadTranslations('en');
    }
  }

  setLanguage(lang: Language) {
    if (this.currentLangSubject.value !== lang) {
      this.currentLangSubject.next(lang);
      this.storageService.setItem('language', lang);
      this.loadTranslations(lang);
    }
  }

  getCurrentLanguage(): Language {
    return this.currentLangSubject.value;
  }

  private loadTranslations(lang: Language) {
    this.http
      .get<TranslationTree>(`/assets/i18n/${lang}.json`)
      .pipe(
        catchError((err) => {
          console.error(`Error loading translations for ${lang}`, err);
          return of({});
        }),
        shareReplay(1),
      )
      .subscribe((translations) => {
        this.translationsSubject.next(translations);
      });
  }

  translate(key: string): Observable<string> {
    return this.translations$.pipe(
      map((translations) => {
        const keys = key.split('.');
        let value: unknown = translations;
        for (const k of keys) {
          // A leaf hit mid-path just walks to undefined, exactly as before.
          value = (value as TranslationTree | undefined)?.[k];
        }
        // A branch-node hit (e.g. translate('NAV')) falls back to the key —
        // the cast form typed the sub-tree object as string (#423, nit 7).
        return typeof value === 'string' && value ? value : key;
      }),
    );
  }
}
