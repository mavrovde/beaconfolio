import { Component, DestroyRef, Input, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, map } from 'rxjs';
import { TranslatePipe } from '@beaconfolio/shared';

import { Profile, ProfileService } from '../../services/profile.service';
import { RenderableProject, formatPeriod, toRenderableProjects } from '../../projects-model/projects';
import { HeaderComponent } from '../header/header.component';
import { SeoService } from '../../services/seo.service';
import { SiteConfigService } from '../../services/site-config.service';
import { rolesLabel } from '../../seo/identity';
import { buildBreadcrumbs, toGraph } from '../../seo/graph';
import { affix } from '../../seo/text';

/**
 * The Projects showcase (#92) — a section on the home page and the `/projects`
 * page, from one component.
 *
 * The dual role copies `BlogComponent`'s `@Input() standalone` idiom rather
 * than inventing a second pattern: embedded on home the profile is passed down
 * from the page that already loaded it, and on its own route the component
 * fetches it. Both paths render the SAME projection, so the two surfaces cannot
 * drift — which is the failure the blog list's shape was designed to avoid.
 */
@Component({
    selector: 'app-projects',
    standalone: true,
    imports: [CommonModule, TranslatePipe, RouterModule, HeaderComponent],
    templateUrl: './projects.component.html',
})
export class ProjectsComponent implements OnInit {
    private profileService = inject(ProfileService);
    private seoService = inject(SeoService);
    private siteConfig = inject(SiteConfigService);
    private destroyRef = inject(DestroyRef);

    /** False when embedded on the home page: no header, no page chrome. */
    @Input() standalone = true;

    /** Supplied by the home page, which has already loaded the profile. */
    @Input() profile: Profile | null = null;

    /** Only used on the standalone route, where nothing hands us a profile. */
    projects$: Observable<RenderableProject[]> | null = null;

    readonly period = formatPeriod;

    ngOnInit(): void {
        if (this.standalone) {
            this.projects$ = this.profileService
                .getProfile()
                .pipe(map((profile) => toRenderableProjects(profile?.projects)));
            // The page declares ITSELF. Without this the SSR head kept the
            // default `updateSeo({})` the config arrival applies — a canonical
            // of `{site}/`, telling crawlers /projects is a duplicate of home
            // while the sitemap listed it as its own URL (measured on the
            // built SSR output). Head writes are DOM-level, zoneless-safe.
            this.siteConfig.config$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((site) => {
                const role = rolesLabel(site.ownerHeadline);
                this.seoService.updateSeo({
                    title: 'Projects',
                    description: `Projects and case studies by ${site.ownerName}${affix(', ', role)}.`,
                    url: '/projects',
                });
                this.seoService.setJsonLd(
                    toGraph([
                        buildBreadcrumbs(site, [
                            { name: 'Home', path: '/' },
                            { name: 'Projects', path: '/projects' },
                        ]),
                    ]),
                );
            });
        }
    }

    /**
     * The embedded path. A getter rather than a field because `profile` is an
     * `@Input` that arrives after construction, and recomputing is free at this
     * size — the alternative is an `ngOnChanges` that exists only to cache a
     * list of a handful of entries.
     */
    get embeddedProjects(): RenderableProject[] {
        return toRenderableProjects(this.profile?.projects);
    }
}
