import { Component, OnInit, PLATFORM_ID, RESPONSE_INIT, inject } from '@angular/core';
import { CommonModule, isPlatformServer } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, combineLatest, map, tap } from 'rxjs';
import { TranslatePipe } from '@beaconfolio/shared';

import { Profile, ProfileService } from '../../../services/profile.service';
import { SeoService } from '../../../services/seo.service';
import {
    SiteConfigService,
    SiteConfig,
    DEFAULT_SITE_CONFIG,
} from '../../../services/site-config.service';
import { RenderableProject, findProject, formatPeriod } from '../../../projects-model/projects';
import { buildProjectSchema } from '../../../seo/project-schema';
import { HeaderComponent } from '../../header/header.component';

/**
 * One project's detail page (#92), `/projects/:slug`.
 *
 * Resolving through `findProject` rather than indexing the raw array is the
 * whole point: the slug the list LINKED to is the de-duplicated one, so the
 * lookup has to run the same projection or two projects sharing a title would
 * both resolve to the first. The unknown-slug case renders a "not found" panel
 * instead of redirecting, so a stale bookmark says what happened rather than
 * silently landing somewhere else — and, exactly as `blog-post` does for a
 * missing post (#109), it sets the outgoing SSR status to a real 404 so the
 * response is not a soft-404 served as 200.
 */
@Component({
    selector: 'app-project-detail',
    standalone: true,
    imports: [CommonModule, TranslatePipe, RouterModule, HeaderComponent],
    templateUrl: './project-detail.component.html',
})
export class ProjectDetailComponent implements OnInit {
    private route = inject(ActivatedRoute);
    private profileService = inject(ProfileService);
    private seoService = inject(SeoService);
    private siteConfig = inject(SiteConfigService);
    private platformId = inject(PLATFORM_ID);
    private responseInit = inject<ResponseInit | null>(RESPONSE_INIT);

    // Starts at the neutral default and updates when the runtime config
    // arrives, the same idiom `blog-post` uses: the JSON-LD is then always
    // emitted, and an unconfigured `siteUrl` simply yields a node with no url.
    private site: SiteConfig = DEFAULT_SITE_CONFIG;
    private ownerName = '';

    project$!: Observable<RenderableProject | undefined>;

    readonly period = formatPeriod;

    ngOnInit(): void {
        // The config feeds the JSON-LD's absolute URL. Read here rather than in
        // an APP_INITIALIZER: a route-extraction build has no backend, and a
        // provider that BLOCKS on this stream never settles (lessons §78).
        this.siteConfig.config$.subscribe((cfg) => (this.site = cfg));

        this.project$ = combineLatest([
            this.profileService.getProfile(),
            this.route.paramMap,
        ]).pipe(
            map(([profile, params]): [Profile | null, RenderableProject | undefined] => [
                profile,
                findProject(profile?.projects, params.get('slug') ?? ''),
            ]),
            tap(([profile, project]) => {
                this.ownerName = profile?.name ?? '';
                if (project) {
                    this.applySeo(project);
                } else {
                    this.handleNotFound();
                }
            }),
            map(([, project]) => project),
        );
    }

    private applySeo(project: RenderableProject): void {
        this.seoService.updateSeo({
            title: project.title,
            description: project.summary || project.description,
            url: `/projects/${project.slug}`,
            image: project.image,
            keywords: project.techStack.join(', '),
        });
        this.seoService.setJsonLd(buildProjectSchema(project, this.site, this.ownerName));
    }

    private handleNotFound(): void {
        this.seoService.setNotFound('Project');
        if (isPlatformServer(this.platformId) && this.responseInit) {
            this.responseInit.status = 404;
        }
    }
}
