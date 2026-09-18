import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';

export const routes: Routes = [
  {
    path: '',
    component: HomeComponent,
  },
  {
    path: 'llm',
    loadComponent: () =>
      import('./components/llm/llm.component').then((m) => m.LlmComponent),
  },
  {
    path: 'blog',
    loadComponent: () =>
      import('./components/blog/blog.component').then((m) => m.BlogComponent),
  },
  {
    path: 'blog/:slug',
    loadComponent: () =>
      import('./components/blog/blog-post/blog-post.component').then(
        (m) => m.BlogPostComponent
      ),
  },
  {
    path: 'projects',
    loadComponent: () =>
      import('./components/projects/projects.component').then(
        (m) => m.ProjectsComponent
      ),
  },
  {
    // Must follow `projects` — a literal segment and a parameterised one are
    // matched in declaration order, so `:slug` declared first would swallow
    // `/projects` itself.
    path: 'projects/:slug',
    loadComponent: () =>
      import('./components/projects/project-detail/project-detail.component').then(
        (m) => m.ProjectDetailComponent
      ),
  },
  {
    // Tailored application link (#250) — one unlisted page per application.
    // Deliberately NOT in the sitemap (`seo/sitemap.ts` STATIC_ROUTES) and
    // disallowed in robots.txt: the slug is the only thing keeping it private.
    path: 'for/:slug',
    loadComponent: () =>
      import('./components/tailored/tailored.component').then(
        (m) => m.TailoredComponent
      ),
  },
  {
    path: 'cv',
    loadComponent: () =>
      import('./components/cv/cv.component').then((m) => m.CvComponent),
  },
  {
    // The site's own 404 (#324). MUST stay last: `**` matches everything, so any
    // route declared after it is dead. Without this entry an unmatched URL never
    // reached Angular at all — the SSR engine declined the request and Express
    // answered with its bare `Cannot GET /…` page.
    path: '**',
    loadComponent: () =>
      import('./components/not-found/not-found.component').then(
        (m) => m.NotFoundComponent
      ),
  },
];
