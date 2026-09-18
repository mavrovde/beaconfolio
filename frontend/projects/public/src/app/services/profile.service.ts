import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, shareReplay, switchMap } from 'rxjs/operators';
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
  date: string;
  credentialUrl?: string;
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
      shareReplay(1),
    );
  }
}
