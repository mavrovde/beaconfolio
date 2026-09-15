import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, ViewportScroller, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';

import { HeaderComponent } from '../header/header.component';
import { HeroComponent } from '../hero/hero.component';
import { AboutComponent } from '../about/about.component';
import { ExperienceComponent } from '../experience/experience.component';
import { SkillsComponent } from '../skills/skills.component';
import { EducationComponent } from '../education/education.component';
// import { RecommendationsComponent } from '../recommendations/recommendations.component';
import { BlogComponent } from '../blog/blog.component';
import { ContactComponent } from '../contact/contact.component';

import { ProfileService, Profile } from '../../services/profile.service';
import { SeoService } from '../../services/seo.service';
import { SiteConfigService } from '../../services/site-config.service';
import { buildPersonSchema } from '../../seo/person-schema';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    HeroComponent,
    AboutComponent,
    ExperienceComponent,
    SkillsComponent,
    EducationComponent,
    // RecommendationsComponent,
    BlogComponent,
    ContactComponent,
  ],
  template: `
    <div
      class="bg-black min-h-screen text-primary selection:bg-primary selection:text-black font-mono"
    >
      <app-header></app-header>

      <main *ngIf="profile$ | async as profile" class="pb-16">
        <app-hero [profile]="profile"></app-hero>
        <app-blog [standalone]="false"></app-blog>

        <!-- Other sections below -->
        <app-about [profile]="profile"></app-about>
        <app-experience [profile]="profile"></app-experience>
        <app-skills [profile]="profile"></app-skills>
        <app-education [profile]="profile"></app-education>
        <!-- <app-recommendations [profile]="profile"></app-recommendations> -->
        <app-contact [profile]="profile"></app-contact>
      </main>
    </div>
  `,
})
export class HomeComponent implements OnInit {
  profile$: Observable<Profile> | null = null;

  constructor(
    private profileService: ProfileService,
    private route: ActivatedRoute,
    private viewportScroller: ViewportScroller,
    private seoService: SeoService,
    private siteConfig: SiteConfigService,
    @Inject(PLATFORM_ID) private platformId: object
  ) { }

  ngOnInit() {
    this.profile$ = this.profileService.getProfile();

    const sectionTitles: Record<string, string> = {
      'blog': 'Blog',
      'about': 'About',
      'experience': 'Experience',
      'skills': 'Skills',
      'education': 'Education',
      'contact': 'Contact'
    };

    this.profile$.pipe(take(1)).subscribe((profile) => {
      if (profile) {
        this.route.fragment.subscribe((fragment) => {
          let titleStr = 'Home';
          if (fragment && sectionTitles[fragment]) {
            titleStr = sectionTitles[fragment];
          }

          this.seoService.updateSeo({
            title: titleStr,
            description: profile.about || profile.headline || undefined,
            keywords: `Software Development, ${profile.headline}, Cloud, AI, ${profile.skills.join(', ')}`
          });
        });

        if (isPlatformBrowser(this.platformId)) {
          this.initScrollLogic();
        }

        // JSON-LD url/sameAs come from the runtime site config (#65), never
        // hardcoded; one-shot stream, bounded with take(1). The mapping —
        // hasOccupation / worksFor / alumniOf / address / seeks (#71) — lives
        // in the pure `buildPersonSchema`, so the component stays dumb.
        this.siteConfig.config$.pipe(take(1)).subscribe((site) => {
          this.seoService.setJsonLd(buildPersonSchema(profile, site));
        });
      }
    });
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
