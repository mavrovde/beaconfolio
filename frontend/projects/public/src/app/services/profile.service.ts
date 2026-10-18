import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import { LanguageService } from '@beaconfolio/shared';
import { environment } from '../../environments/environment';
import { Project } from '../projects-model/projects';

export interface Profile {
  name: string;
  headline: string;
  location: string;
  about: string;
  experience: Experience[];
  education: Education[];
  skills: string[];
  // Site-enriched / scraper-optional: a raw uploaded profile_data.json may omit
  // these, so they are optional and every consuming block guards for absence.
  certifications?: Certification[];
  languages?: Language[];
  recommendations?: Recommendation[];
  contact?: Contact;
  // #92. Optional for the same reason as the block above: the backend already
  // allowlists `projects` and the bundled demo carries an empty array, so an
  // older uploaded profile simply omits it and every consumer must render
  // nothing rather than fail. The shape lives in `projects-model/projects.ts`
  // with the pure projection that makes it renderable.
  projects?: Project[];
}

export type { Project } from '../projects-model/projects';

export interface Contact {
  email: string;
  linkedin: string;
}

export interface Experience {
  title: string;
  company: string;
  employmentType?: string;
  startDate: string;
  endDate: string;
  duration?: string;
  location?: string;
  workType?: string;
  description?: string;
  skills?: string[];
  companyLinkedInUrl?: string;
}

export interface Education {
  school: string;
  degree: string;
  years: string;
  skills?: string;
}

export interface Certification {
  name: string;
  issuer: string;
  /** Display date. The bundled demo profile writes it here directly. */
  date?: string;
  /** What the LinkedIn scraper writes (`"Sep 2026"`); copied into `date`. */
  issueDate?: string;
  credentialUrl?: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Sortable key for a certification date, as `year * 12 + month` (month 0 when
 * only a year is known), or `null` when the text carries no recognisable date.
 * Accepts the scraper's `"Sep 2026"`, a bare `"2026"` and ISO `"2026-09[-18]"`.
 */
export function certificationDateKey(text: string | undefined): number | null {
  const value = (text ?? '').trim().toLowerCase();
  const iso = /^(\d{4})-(\d{2})/.exec(value);
  if (iso) {
    return Number(iso[1]) * 12 + Number(iso[2]) - 1;
  }
  const monthYear = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(value);
  if (monthYear && MONTHS.includes(monthYear[1])) {
    return Number(monthYear[2]) * 12 + MONTHS.indexOf(monthYear[1]);
  }
  const year = /^(\d{4})$/.exec(value);
  return year ? Number(year[1]) * 12 : null;
}

/**
 * Newest first, undated last. The sort is stable, so certifications issued in
 * the same month keep the order the upload gave them (LinkedIn's own order).
 * An upload's array order is NOT a date order — the scraper keeps LinkedIn's
 * API order — so the site must not render it as-is.
 */
export function sortCertificationsNewestFirst(certs: Certification[]): Certification[] {
  return certs
    .map((cert) => ({ ...cert, date: cert.date || cert.issueDate || '' }))
    .map((cert, index) => ({ cert, index, key: certificationDateKey(cert.date) }))
    .sort((a, b) => {
      if (a.key === b.key) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return b.key - a.key;
    })
    .map(({ cert }) => cert);
}

/** Display-ready profile: certifications dated and in date order. */
export function normalizeProfile(profile: Profile): Profile {
  return profile.certifications
    ? { ...profile, certifications: sortCertificationsNewestFirst(profile.certifications) }
    : profile;
}

export interface Language {
  name: string;
  proficiency: string;
}

export interface Recommendation {
  author: string;
  authorTitle: string;
  authorLinkedInUrl: string;
  text: string;
}

@Injectable({
  providedIn: 'root',
})
export class ProfileService {
  private http = inject(HttpClient);
  private languageService = inject(LanguageService);

  private dataUrlBase = 'assets/profile_data';

  /**
   * Load the active profile for the current language from the backend
   * (`/profile?lang=…`), falling back to the bundled static asset when the
   * backend has no active version yet or is unreachable — so the site is never
   * blank before the first admin upload.
   */
  getProfile(): Observable<Profile> {
    return this.languageService.currentLang$.pipe(
      switchMap((lang) => {
        const apiUrl = `${environment.apiUrl}${environment.apiPrefix}/profile?lang=${lang}`;
        return this.http
          .get<Profile>(apiUrl)
          .pipe(catchError(() => this.http.get<Profile>(`${this.dataUrlBase}_${lang}.json`)));
      }),
      map(normalizeProfile),
      shareReplay(1),
    );
  }
}
