import { Component, Input, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Observable, map } from 'rxjs';
import { TranslatePipe } from '@beaconfolio/shared';
import { Profile } from '../../services/profile.service';
import { SiteConfigService } from '../../services/site-config.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './hero.component.html',
  styleUrls: ['./hero.component.css'],
})
export class HeroComponent {
  private platformId = inject(PLATFORM_ID);

  @Input() profile: Profile | null = null;

  /** Runtime portrait (#333): the backend serves the admin-uploaded photo at
   *  this URL; 404 before the first upload. The template renders it directly
   *  and flips to the baked placeholder on the img error event, so a fresh
   *  fork looks exactly as before — no rebuild, no restart, and the SSR HTML
   *  carries the API URL (the error event only exists in the browser). */
  readonly photoUrl = `${environment.apiUrl}${environment.apiPrefix}/profile/photo`;
  readonly placeholderUrl = 'assets/images/profile.png';
  photoFailed = false;

  onPhotoError(): void {
    this.photoFailed = true;
  }

  /** Job-search state (#271), rendered via the async pipe (rule 5 — the app
   *  is zoneless; a stream keeps the repaint automatic). The i18n key is
   *  derived here so the template stays dumb. */
  readonly availability$: Observable<{ state: string; key: string }>;

  constructor() {
    const siteConfigService = inject(SiteConfigService);

    this.availability$ = siteConfigService.config$.pipe(
      map((config) => ({
        state: config.availability,
        key: `AVAILABILITY.${config.availability.toUpperCase()}`,
      })),
    );
  }

  scrollTo(id: string, event: Event) {
    event.preventDefault();

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const element = document.querySelector(id);
    if (element) {
      const headerOffset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - headerOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });
    }
  }
}
