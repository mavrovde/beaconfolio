import { ChangeDetectorRef, Component, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Language, LanguageService } from '@beaconfolio/shared';
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
  currentLang: Language = 'en';
  years: number[] = [];
  selectedYearIndex: number = 0;

  navItems = [
    { labelKey: 'NAV.BLOG', href: '#blog' },
    { labelKey: 'NAV.ABOUT', href: '#about' },
    { labelKey: 'NAV.EXPERIENCE', href: '#experience' },
    { labelKey: 'NAV.SKILLS', href: '#skills' },
    { labelKey: 'NAV.EDUCATION', href: '#education' },
    { labelKey: 'NAV.CV', href: '/cv' },
    { labelKey: 'NAV.CONTACT', href: '#contact' },
    { labelKey: 'NAV.LLM', href: '/llm' },
  ];

  constructor(
    private languageService: LanguageService,
    private yearsService: YearsService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: object,
    private cdr: ChangeDetectorRef
  ) {
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
