import { ChangeDetectorRef, Component, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Language, LanguageService, ShellChromeService } from '@beaconfolio/shared';
import { YearsService } from '../../services/years.service';
import { TranslatePipe } from '@beaconfolio/shared';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, TranslatePipe, RouterLink, RouterLinkActive],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css'],
})
export class HeaderComponent {
  private languageService = inject(LanguageService);
  private yearsService = inject(YearsService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  private shell = inject(ShellChromeService);

  // The brand mark, from config (#67). It was the literal `>_ SM` — the
  // owner's own initials, with terminal chrome baked in, in a template a
  // forker would have had to edit. Both halves are streams so the `async`
  // pipe renders them: a configured logo image wins, otherwise the wordmark
  // (initials from `ownerName`, `>_`-prefixed only under a shell-chrome
  // preset). FIELDS, not calls — see ShellChromeService on why.
  readonly logoUrl$ = this.shell.logoUrl$;
  readonly wordmark$ = this.shell.wordmark$;

  currentLang: Language = 'en';
  years: number[] = [];
  selectedYearIndex: number = 0;

  navItems = [
    { labelKey: 'NAV.BLOG', href: '#blog' },
    // A ROUTE, not a fragment: the section only exists on home when the profile
    // carries projects, and the nav is rendered on every page. `/projects`
    // always resolves; `#projects` would be a dead anchor on /cv and /blog.
    { labelKey: 'NAV.PROJECTS', href: '/projects' },
    { labelKey: 'NAV.ABOUT', href: '#about' },
    { labelKey: 'NAV.EXPERIENCE', href: '#experience' },
    { labelKey: 'NAV.SKILLS', href: '#skills' },
    { labelKey: 'NAV.EDUCATION', href: '#education' },
    { labelKey: 'NAV.CV', href: '/cv' },
    { labelKey: 'NAV.CONTACT', href: '#contact' },
    { labelKey: 'NAV.LLM', href: '/llm' },
  ];

  constructor() {
    this.languageService.currentLang$.subscribe((lang) => {
      this.currentLang = lang;
      // Zoneless: a post-load language switch is an async emission that mutates a
      // plain template binding — repaint explicitly (#105).
      this.cdr.markForCheck();
    });

    // Subscribe in the constructor (an injection context) rather than ngOnInit so that
    // a synchronous `shareReplay(1)` replay from YearsService populates `years` /
    // `selectedYearIndex` BEFORE the component's first change-detection pass. Doing it in
    // ngOnInit let a cached (sync) emission mutate these bindings after the view was
    // checked, triggering NG0100 (ExpressionChangedAfterItHasBeenCheckedError) in dev mode.
    this.yearsService.getYears().subscribe((years) => {
      // Reverse to ascending order: oldest (left) → newest (right)
      this.years = [...years].reverse();
      this.selectedYearIndex = this.years.length - 1; // default to newest
      // Zoneless: an async (non-replayed) emission mutates plain slider bindings —
      // repaint explicitly so the year slider appears (#105).
      this.cdr.markForCheck();
    });
  }

  absDiff(a: number, b: number): number {
    return Math.abs(a - b);
  }

  prevYear(): void {
    if (this.selectedYearIndex > 0) {
      this.selectedYearIndex--;
      this.scrollToYear(this.years[this.selectedYearIndex]);
    }
  }

  nextYear(): void {
    if (this.selectedYearIndex < this.years.length - 1) {
      this.selectedYearIndex++;
      this.scrollToYear(this.years[this.selectedYearIndex]);
    }
  }

  selectYearByIndex(index: number): void {
    this.selectedYearIndex = index;
    this.scrollToYear(this.years[index]);
  }

  scrollToYear(year: number): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.router.navigate(['/'], { fragment: 'experience' });
      return;
    }

    this.router.navigate(['/'], { fragment: 'experience' }).then(() => {
      setTimeout(() => this._scrollToYearElement(year), 500);
    });
  }

  private _scrollToYearElement(year: number): void {
    const element = document.querySelector(`[data-year="${year}"]`);
    if (element) {
      const headerOffset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - headerOffset;
      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    } else {
      const experienceSection = document.querySelector('#experience');
      if (experienceSection) {
        const headerOffset = 80;
        const elementPosition = experienceSection.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.scrollY - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      }
    }
  }

  scrollTo(href: string, event: Event) {
    event.preventDefault();
    if (href.startsWith('/')) {
      this.router.navigate([href]);
      return;
    }

    this.router.navigate(['/'], { fragment: href.substring(1) });
  }

  switchLanguage(lang: Language): void {
    this.languageService.setLanguage(lang);
  }
}
