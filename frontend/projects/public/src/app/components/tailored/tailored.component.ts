import { Component, OnInit, Inject, PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { CommonModule, isPlatformBrowser, isPlatformServer } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, filter, map, startWith, switchMap, take, tap } from 'rxjs/operators';

import { HeaderComponent } from '../header/header.component';
import { HeroComponent } from '../hero/hero.component';
import { AboutComponent } from '../about/about.component';
import { ExperienceComponent } from '../experience/experience.component';
import { SkillsComponent } from '../skills/skills.component';
import { EducationComponent } from '../education/education.component';
import { ContactComponent } from '../contact/contact.component';

import { Profile, ProfileService } from '../../services/profile.service';
import { SeoService } from '../../services/seo.service';
import { TailoredLinkService, TailoredView } from '../../services/tailored-link.service';
import { applyTailoring } from '../../tailored/tailoring';

/** View state for `/for/:slug`; mirrors `BlogPostVm`'s three-state contract. */
export interface TailoredVm {
    status: 'loading' | 'found' | 'notfound';
    view?: TailoredView;
    /** The profile re-ordered for this application (never filtered). */
    profile?: Profile;
    cvUrl?: string | null;
}

/**
 * Tailored application link (#250): the portfolio as one recruiter should read
 * it — a personal note, the relevant skills and roles first, and the CV variant
 * the owner actually attached to that application.
 *
 * Three things are deliberate here:
 *
 * 1. **Unknown / disabled / expired all render the same not-found panel** and
 *    set a real SSR 404 (`RESPONSE_INIT`, the #109 pattern), so a revoked link
 *    is indistinguishable from a guessed one.
 * 2. **`noindex` on every render.** A tailored link is shared with ONE
 *    recipient; it must never enter a search index (criterion 3). `robots.txt`
 *    disallows `/for/` as well — belt and braces, because robots.txt is a
 *    request, not an enforcement.
 * 3. **The visit is counted from the BROWSER only.** SSR renders the same page
 *    server-side; counting there would double every real visit.
 */
@Component({
    selector: 'app-tailored',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        HeaderComponent,
        HeroComponent,
        AboutComponent,
        ExperienceComponent,
        SkillsComponent,
        EducationComponent,
        ContactComponent,
    ],
    template: `
    <div class="bg-black min-h-screen text-primary selection:bg-primary selection:text-black font-mono">
      <app-header></app-header>

      <ng-container *ngIf="vm$ | async as vm">
        <main *ngIf="vm.status === 'found'" class="pb-16">
          <!-- The personal note: the first thing the recruiter reads -->
          <section
            class="max-w-4xl mx-auto px-6 pt-8"
            data-testid="tailored-banner"
          >
            <div class="border border-dashed border-terminal-dim rounded p-6 space-y-4">
              <p class="text-sm text-secondary">
                <span class="text-terminal-highlight">$</span>
                prepared for
                <span class="text-primary font-bold" data-testid="tailored-company">{{ vm.view!.company }}</span>
                ·
                <span data-testid="tailored-role">{{ vm.view!.role_title }}</span>
              </p>

              <p
                *ngIf="vm.view!.headline_note"
                class="text-primary whitespace-pre-wrap"
                data-testid="tailored-note"
              >{{ vm.view!.headline_note }}</p>

              <div *ngIf="vm.view!.highlighted_skills.length" class="flex flex-wrap gap-2">
                <span class="text-xs text-secondary self-center">relevant:</span>
                <span
                  *ngFor="let skill of vm.view!.highlighted_skills"
                  class="text-xs border border-terminal-highlight text-terminal-highlight px-2 py-1 rounded"
                  data-testid="tailored-skill"
                >{{ skill }}</span>
              </div>

              <ul *ngIf="vm.view!.highlighted_projects.length" class="text-sm text-secondary space-y-1">
                <li *ngFor="let project of vm.view!.highlighted_projects" data-testid="tailored-project">
                  <span class="text-terminal-highlight">&gt;</span> {{ project }}
                </li>
              </ul>

              <!-- Variant-aware CV CTA: the pinned variant when there is one, the
                   site's normal CV flow when there is not. -->
              <a
                *ngIf="vm.cvUrl; else standardCv"
                [href]="vm.cvUrl"
                class="inline-block text-terminal-highlight hover:text-white hover:underline decoration-dashed"
                data-testid="tailored-cv-cta"
              >[ download CV{{ vm.view!.cv_version ? ' · ' + vm.view!.cv_version : '' }} ]</a>
              <ng-template #standardCv>
                <a
                  routerLink="/cv"
                  class="inline-block text-terminal-highlight hover:text-white hover:underline decoration-dashed"
                  data-testid="tailored-cv-cta"
                >[ request the CV ]</a>
              </ng-template>
            </div>
          </section>

          <ng-container *ngIf="vm.profile as profile">
            <app-hero [profile]="profile"></app-hero>
            <app-about [profile]="profile"></app-about>
            <app-experience [profile]="profile"></app-experience>
            <app-skills [profile]="profile"></app-skills>
            <app-education [profile]="profile"></app-education>
            <app-contact [profile]="profile"></app-contact>
          </ng-container>
        </main>

        <!-- Unknown, disabled or expired — one indistinguishable outcome -->
        <div
          *ngIf="vm.status === 'notfound'"
          class="max-w-4xl mx-auto px-6 py-16 text-center space-y-6"
          data-testid="tailored-not-found"
        >
          <div class="text-terminal-highlight text-lg">$ cat ~/for/{{ slug }}: No such file or directory</div>
          <h1 class="text-2xl md:text-3xl font-bold text-primary">404 — this link is no longer available</h1>
          <p class="text-secondary">
            The tailored link you opened does not exist, was disabled, or has expired.
          </p>
          <a routerLink="/" class="text-terminal-highlight hover:text-white hover:underline decoration-dashed">
            [ cd ~ ] go to the portfolio
          </a>
        </div>

        <div *ngIf="vm.status === 'loading'" class="max-w-4xl mx-auto px-6 py-16 text-secondary animate-pulse">
          $ loading resource...
        </div>
      </ng-container>
    </div>
  `,
})
export class TailoredComponent implements OnInit {
    vm$: Observable<TailoredVm> | null = null;
    /** Echoed in the not-found panel; read from the snapshot, never mutated. */
    slug = '';

    constructor(
        private route: ActivatedRoute,
        private tailoredLinks: TailoredLinkService,
        private profileService: ProfileService,
        private seoService: SeoService,
        @Inject(PLATFORM_ID) private platformId: object,
        // Server-side this is the mutable ResponseInit the @angular/ssr engine
        // builds the outgoing Response from; in the browser (and in unit tests)
        // the platform factory yields null. Mutating `.status` during render is
        // what turns a soft-404 into a real HTTP 404 (#109).
        @Inject(RESPONSE_INIT) private responseInit: ResponseInit | null,
    ) {}

    ngOnInit(): void {
        this.slug = this.route.snapshot.paramMap.get('slug') ?? '';

        this.vm$ = this.route.paramMap.pipe(
            switchMap((params) => {
                const slug = params.get('slug');
                if (!slug) {
                    this.handleNotFound();
                    return of<TailoredVm>({ status: 'notfound' });
                }
                return this.tailoredLinks.getView(slug).pipe(
                    switchMap((view) =>
                        this.profileService.getProfile().pipe(
                            map((profile) => ({
                                status: 'found' as const,
                                view,
                                profile: applyTailoring(
                                    profile,
                                    view.highlighted_skills,
                                    view.highlighted_projects,
                                ),
                                cvUrl: this.tailoredLinks.cvDownloadUrl(view),
                            })),
                        ),
                    ),
                    tap((vm) => this.applySeo(vm.view)),
                    // A revoked, expired or unknown slug (404 from the API →
                    // HttpClient throws) and a transient failure land on the
                    // same panel: the recipient must not be able to tell them
                    // apart, and neither may a crawler.
                    catchError(() => {
                        this.handleNotFound();
                        return of<TailoredVm>({ status: 'notfound' });
                    }),
                    startWith<TailoredVm>({ status: 'loading' }),
                );
            }),
        );

        this.recordVisit();
    }

    /**
     * Count the opening — browser only, and never fatal to the page.
     * No component state is written here, so there is nothing to repaint
     * (the app is zoneless).
     */
    private recordVisit(): void {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }
        this.route.paramMap
            .pipe(
                take(1),
                map((params) => params.get('slug')),
                filter((slug): slug is string => !!slug),
                switchMap((slug) =>
                    this.tailoredLinks.recordVisit(slug).pipe(catchError(() => of(void 0))),
                ),
            )
            .subscribe();
    }

    private applySeo(view: TailoredView): void {
        this.seoService.updateSeo({
            title: `For ${view.company} · ${view.role_title}`,
            description:
                view.headline_note ?? `A portfolio view prepared for ${view.company}.`,
            url: `/for/${view.slug}`,
        });
        // Criterion 3: a link shared with ONE recipient never enters an index.
        this.seoService.setNoIndex();
    }

    private handleNotFound(): void {
        // "Link", not the 'Post' default: an unknown/disabled/expired /for/:slug
        // is a missing tailored LINK, and the subject is what the <title> says.
        this.seoService.setNotFound('Link');
        if (isPlatformServer(this.platformId) && this.responseInit) {
            this.responseInit.status = 404;
        }
    }
}
