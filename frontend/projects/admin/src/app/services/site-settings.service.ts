import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Runtime site settings (#271, #339) — the keys the owner changes without a
 *  redeploy: the job-search availability rendered on the public hero, and the
 *  preset theme the public site paints itself with. Both vocabularies mirror
 *  their constants in backend/app/api/site_settings.py; a TypeScript file
 *  cannot import Python, so a backend test reads THIS file and fails if the
 *  copies drift. */
export const AVAILABILITY_STATES = ['open', 'listening', 'not_looking'] as const;

/** The theme vocabulary is **not declared here** (#67) — it lives once in
 *  `@beaconfolio/shared`, which both apps consume. A preset listed in the
 *  admin console alone used to render a picker button whose write the API
 *  rejects with a 422; there is no second list to get that wrong now. */
export { THEME_PRESETS } from '@beaconfolio/shared';

/** A one-line description per preset, shown beside the picker so the choice is
 *  legible without opening the public site in five tabs.
 *
 *  Keep these HONEST about type: `body` takes `--font-sans` per preset, but 58
 *  `font-mono` utilities across 14 public templates still pin their own
 *  elements to the monospace stack, so a non-terminal preset is mixed rather
 *  than uniformly serif/sans until #67 makes fonts config-driven. The wording
 *  below says "body" for that reason — a picker that promised a serif site and
 *  delivered a serif paragraph beside monospace panels would be the same class
 *  of claim-without-measurement the theme contract exists to stop. */
export const THEME_DESCRIPTIONS: Readonly<Record<string, string>> = {
    terminal: 'Green phosphor CRT — the default, with scanlines and glow',
    dark: 'Neutral dark, no CRT effects',
    light: 'Light background, dark text',
    modern: 'System sans body on white, soft elevation',
    classic: 'Serif body on warm paper, document-like',
};

export interface AvailabilityValue {
    value: string;
}

export interface ThemeValue {
    value: string;
}

@Injectable({
    providedIn: 'root'
})
export class SiteSettingsService {
    private http = inject(HttpClient);
    private base = `${environment.apiUrl}${environment.apiPrefix}/admin/site-settings`;

    getAvailability(): Observable<AvailabilityValue> {
        return this.http.get<AvailabilityValue>(`${this.base}/availability`);
    }

    setAvailability(value: string): Observable<AvailabilityValue> {
        return this.http.put<AvailabilityValue>(`${this.base}/availability`, { value });
    }

    getTheme(): Observable<ThemeValue> {
        return this.http.get<ThemeValue>(`${this.base}/theme`);
    }

    setTheme(value: string): Observable<ThemeValue> {
        return this.http.put<ThemeValue>(`${this.base}/theme`, { value });
    }
}
