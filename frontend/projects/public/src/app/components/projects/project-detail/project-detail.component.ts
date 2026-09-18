import { Component, OnInit, PLATFORM_ID, RESPONSE_INIT, inject } from '@angular/core';
import { CommonModule, isPlatformServer } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, combineLatest, map, startWith, tap } from 'rxjs';
import { TranslatePipe } from '@beaconfolio/shared';

import { ProfileService } from '../../../services/profile.service';
import { SeoService } from '../../../services/seo.service';
import { SiteConfigService, SiteConfig } from '../../../services/site-config.service';
import { RenderableProject, findProject, formatPeriod } from '../../../projects-model/projects';
import { buildProjectSchema } from '../../../seo/project-schema';
import { HeaderComponent } from '../../header/header.component';

/**
 * View state for the detail page. `loading` is a real arm, not decoration: the
 * `@else` of a two-state template fires while the profile is still in flight,
 * so a browser navigation to a project that DOES exist flashed "That project no
 * longer exists." first. `blog-post` carries the same three states for the same
 * reason (#25/#109).
 */
export interface ProjectDetailVm {
    status: 'loading' | 'found' | 'notfound';
    project?: RenderableProject;
}

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

    vm$!: Observable<ProjectDetailVm>;

    readonly period = formatPeriod;

    ngOnInit(): void {
        // The site config is a SOURCE of this view, not a field latched beside
        // it. Subscribing separately and assigning `this.site` was two bugs at
        // once: in a ZONELESS app an assignment from inside an async callback
        // never repaints (#94/#118, which is what the cd-safety lint rule
        // catches), and whichever of the two HTTP streams resolved first won —
        // a profile that arrived before the config built the JSON-LD against
        // `DEFAULT_SITE_CONFIG.siteUrl === ''` and nothing ever corrected it.
        // Combined here, the schema cannot be built from a config that has not
        // arrived. Read in the stream rather than in an APP_INITIALIZER: a
        // route-extraction build has no backend, and a provider that BLOCKS on
        // this stream never settles (lessons §78).
        this.vm$ = combineLatest([
            this.profileService.getProfile(),
            this.route.paramMap,
            this.siteConfig.config$,
        ]).pipe(
            map(([profile, params, site]) => ({
                site,
                ownerName: profile?.name ?? '',
                project: findProject(profile?.projects, params.get('slug') ?? ''),
            })),
            tap(({ site, ownerName, project }) => {
                if (project) {
                    this.applySeo(project, site, ownerName);
                } else {
                    this.handleNotFound();
                }
            }),
            map(
                ({ project }): ProjectDetailVm =>
                    project ? { status: 'found', project } : { status: 'notfound' }
            ),
            startWith<ProjectDetailVm>({ status: 'loading' })
        );
    }

    private applySeo(project: RenderableProject, site: SiteConfig, ownerName: string): void {
        this.seoService.updateSeo({
            title: project.title,
            description: project.summary || project.description,
            url: `/projects/${project.slug}`,
            image: project.image,
            keywords: project.techStack.join(', '),
        });
        this.seoService.setJsonLd(buildProjectSchema(project, site, ownerName));
    }

    private handleNotFound(): void {
        this.seoService.setNotFound('Project');
        if (isPlatformServer(this.platformId) && this.responseInit) {
            this.responseInit.status = 404;
        }
    }
}
