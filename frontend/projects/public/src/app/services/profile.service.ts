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

/**
 * Display-ready certification: `date` falls back to the scraper's `issueDate`
 * (the CV template renders `date`). An explicit `date` wins when both are set —
 * the backend orders by the same precedence (`json_resume.certificate_date`),
 * so the badge shows the value the list is sorted by.
 */
export function displayCertification(cert: Certification): Certification {
  return { ...cert, date: cert.date || cert.issueDate || '' };
}

/**
 * Display-ready profile. ORDER is not decided here: the backend's
 * `public_profile_view` sorts certifications (newest first, undated last,
 * one date parser for English and German month names) for the site and
 * `resume.json` alike. The bundled static fallback asset is rendered in the
 * order it is written.
 */
export function normalizeProfile(profile: Profile): Profile {
  return profile.certifications
    ? { ...profile, certifications: profile.certifications.map(displayCertification) }
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
