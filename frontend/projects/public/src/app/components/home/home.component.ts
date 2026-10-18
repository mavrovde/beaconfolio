import { Component, DestroyRef, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, ViewportScroller, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Observable, combineLatest } from 'rxjs';
import { take } from 'rxjs/operators';
import { LanguageService } from '@beaconfolio/shared';

import { HeaderComponent } from '../header/header.component';
import { HeroComponent } from '../hero/hero.component';
import { AboutComponent } from '../about/about.component';
import { ExperienceComponent } from '../experience/experience.component';
import { ProjectsComponent } from '../projects/projects.component';
import { SkillsComponent } from '../skills/skills.component';
import { EducationComponent } from '../education/education.component';
// import { RecommendationsComponent } from '../recommendations/recommendations.component';
import { BlogComponent } from '../blog/blog.component';
import { ContactComponent } from '../contact/contact.component';
import { AtAGlanceComponent } from '../at-a-glance/at-a-glance.component';

import { ProfileService, Profile } from '../../services/profile.service';
import { SeoService } from '../../services/seo.service';
import { SiteConfig, SiteConfigService } from '../../services/site-config.service';
import { buildPersonSchema } from '../../seo/person-schema';
import { buildProfilePage, buildWebSite, toGraph } from '../../seo/graph';
import { IdentityInput, buildHomeDescription, buildHomeTitle, buildKeywords } from '../../seo/identity';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    HeroComponent,
    AtAGlanceComponent,
    AboutComponent,
    ExperienceComponent,
    ProjectsComponent,
    SkillsComponent,
    EducationComponent,
    // RecommendationsComponent,
    BlogComponent,
    ContactComponent,
  ],
  template: `
    <div
      class="bg-black min-h-screen text-primary selection:bg-primary selection:text-black font-sans"
      >
      <app-header></app-header>
    
      @if (profile$ | async; as profile) {
        <main class="pb-16">
          <app-hero [profile]="profile"></app-hero>
          <app-at-a-glance [profile]="profile"></app-at-a-glance>
          <app-blog [standalone]="false"></app-blog>
          <!-- Other sections below -->
          <app-about [profile]="profile"></app-about>
          <app-experience [profile]="profile"></app-experience>
          <app-projects [standalone]="false" [profile]="profile"></app-projects>
          <app-skills [profile]="profile"></app-skills>
          <app-education [profile]="profile"></app-education>
          <!-- <app-recommendations [profile]="profile"></app-recommendations> -->
          <app-contact [profile]="profile"></app-contact>
        </main>
      }
    </div>
    `,
})
export class HomeComponent implements OnInit {
  private profileService = inject(ProfileService);
  private route = inject(ActivatedRoute);
  private viewportScroller = inject(ViewportScroller);
  private seoService = inject(SeoService);
  private siteConfig = inject(SiteConfigService);
  private platformId = inject(PLATFORM_ID);
  private languageService = inject(LanguageService);
  private destroyRef = inject(DestroyRef);

  profile$: Observable<Profile> | null = null;

  ngOnInit() {
    this.profile$ = this.profileService.getProfile();

    // Every SEO string is COMPOSED from the profile + runtime site config by
    // the pure builders in `seo/identity.ts` (template product: nothing about
    // the owner is written here). Re-composed when the language, the profile
    // or the fragment changes; Title/Meta/JSON-LD are DOM-level writes, so
    // this subscription is zoneless-safe without a CD trigger.
    combineLatest([
      this.profile$,
      this.siteConfig.config$,
      this.languageService.currentLang$,
      this.route.fragment,
      this.profileService.getLastModified(),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([profile, site, lang, fragment, lastModified]) => {
        if (profile) {
          this.applySeo(profile, site, lang, fragment, lastModified);
        }
      });

    if (isPlatformBrowser(this.platformId)) {
      this.profile$.pipe(take(1)).subscribe((profile) => {
        if (profile) {
          this.initScrollLogic();
        }
      });
    }
  }

  private applySeo(
    profile: Profile,
    site: SiteConfig,
    lang: string,
    fragment: string | null,
    lastModified: string | null,
  ): void {
    const sectionTitles: Record<string, string> = {
      'blog': 'Blog',
      'about': 'About',
      'experience': 'Experience',
      'skills': 'Skills',
      'education': 'Education',
      'contact': 'Contact'
    };
    const identity: IdentityInput = {
      name: profile.name,
      headline: profile.headline,
      location: profile.location,
      about: profile.about,
      skills: profile.skills,
      availability: site.availability,
      lang,
    };
    const homeTitle = buildHomeTitle(identity, site);
    const section = fragment ? sectionTitles[fragment] : undefined;
    this.seoService.updateSeo({
      ...(section ? { title: section } : { fullTitle: homeTitle }),
      description: buildHomeDescription(identity, site),
      keywords: buildKeywords(identity, site),
    });

    // One graph: the Person (with the stable `{site}/#person` id every other
    // page references), the WebSite it publishes and the ProfilePage about it.
    this.seoService.setJsonLd(
      toGraph([
        buildPersonSchema(profile, site),
        buildWebSite(site, lang),
        buildProfilePage(site, { path: '/', name: homeTitle, lang, dateModified: lastModified }),
      ]),
    );
  }

  private initScrollLogic() {
    // Persistent scroll logic to handle layout expansion
    let attempts = 0;
    const maxAttempts = 30; // 3 seconds max look time
    let scrollAttempts = 0;
    const maxScrollAttempts = 15; // Continue scrolling for 1.5 seconds after finding

    const interval = setInterval(() => {
      attempts++;
      const fragment = this.route.snapshot.fragment;
      if (fragment) {
        const element = document.getElementById(fragment);
        if (element) {
          if (scrollAttempts === 0) {
            console.log(`HomeComponent: Found anchor '${fragment}', starting persistent scroll...`);
          }
          this.viewportScroller.scrollToAnchor(fragment);
          scrollAttempts++;

          if (scrollAttempts >= maxScrollAttempts) {
            console.log(`HomeComponent: Finished persistent scroll for '${fragment}'`);
            clearInterval(interval);
          }
        } else {
          // Not found yet
          if (attempts >= maxAttempts) {
            console.log(`HomeComponent: Failed to find anchor '${fragment}' after ${maxAttempts} attempts`);
            clearInterval(interval);
          }
        }
      } else {
        clearInterval(interval);
      }
    }, 100);
  }


}
