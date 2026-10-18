import { Component, Input, OnChanges, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { LanguageService } from '@beaconfolio/shared';
import { Profile } from '../../services/profile.service';
import { SiteConfigService } from '../../services/site-config.service';
import { AtAGlance, buildAtAGlance } from '../../seo/at-a-glance';

/**
 * Dumb renderer for `buildAtAGlance` (rule 5: the composition lives in the
 * pure builder). Server-rendered with the rest of the home page, so the
 * sentences are in the HTML a crawler or answer engine reads.
 *
 * Zoneless-safe: the view is ONE observable rendered through the async pipe;
 * the `profile` input is pushed into a subject, never read from a callback.
 */
@Component({
    selector: 'app-at-a-glance',
    standalone: true,
    imports: [AsyncPipe],
    template: `
    @if (glance$ | async; as glance) {
      <section id="at-a-glance" class="py-12 relative" data-testid="at-a-glance">
        <div class="container mx-auto px-6">
          <h2 class="text-2xl font-bold mb-6 text-secondary font-sans">{{ glance.heading }}</h2>
          <div class="max-w-4xl mx-auto p-6 border border-terminal bg-black font-sans">
            <p class="text-primary text-lg leading-relaxed mb-6" data-testid="at-a-glance-lead">{{ glance.lead }}</p>
            <div class="space-y-4">
              @for (item of glance.items; track item.question) {
                <div>
                  <h3 class="text-secondary font-bold">{{ item.question }}</h3>
                  <p class="text-primary leading-relaxed">{{ item.answer }}</p>
                </div>
              }
            </div>
          </div>
        </div>
      </section>
    }
    `,
})
export class AtAGlanceComponent implements OnChanges {
    private languageService = inject(LanguageService);
    private siteConfig = inject(SiteConfigService);
    private profile$ = new BehaviorSubject<Profile | null>(null);

    @Input() profile: Profile | null = null;

    readonly glance$: Observable<AtAGlance | null> = combineLatest([
        this.profile$,
        this.siteConfig.config$,
        this.languageService.currentLang$,
    ]).pipe(map(([profile, site, lang]) => buildAtAGlance(profile, site.availability, lang)));

    ngOnChanges(): void {
        this.profile$.next(this.profile);
    }
}
