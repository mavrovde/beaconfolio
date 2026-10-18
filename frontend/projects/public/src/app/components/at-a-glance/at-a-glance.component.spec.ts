import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { describe, it, expect, beforeEach } from 'vitest';
import { Language, LanguageService } from '@beaconfolio/shared';
import { AtAGlanceComponent } from './at-a-glance.component';
import { Profile } from '../../services/profile.service';
import { DEFAULT_SITE_CONFIG, SiteConfig, SiteConfigService } from '../../services/site-config.service';

const PROFILE: Profile = {
    name: 'Jane Doe',
    headline: 'Staff Engineer',
    location: 'Berlin, Germany',
    about: '',
    skills: ['Go'],
    experience: [],
    education: [],
};

describe('AtAGlanceComponent', () => {
    let lang$: BehaviorSubject<Language>;
    let config$: BehaviorSubject<SiteConfig>;

    beforeEach(() => {
        lang$ = new BehaviorSubject<Language>('en');
        config$ = new BehaviorSubject<SiteConfig>({ ...DEFAULT_SITE_CONFIG, availability: 'open' });
        TestBed.configureTestingModule({
            imports: [AtAGlanceComponent],
            providers: [
                { provide: LanguageService, useValue: { currentLang$: lang$ } },
                { provide: SiteConfigService, useValue: { config$ } },
            ],
        });
    });

    function render(profile: Profile | null) {
        const fixture = TestBed.createComponent(AtAGlanceComponent);
        fixture.componentRef.setInput('profile', profile);
        fixture.detectChanges();
        return fixture;
    }

    it('renders the composed lead and one h3 per question, under an h2', () => {
        const el: HTMLElement = render(PROFILE).nativeElement;
        expect(el.querySelector('h2')?.textContent?.trim()).toBe('At a glance');
        expect(el.querySelector('h1')).toBeNull();
        expect(el.querySelector('[data-testid="at-a-glance-lead"]')?.textContent).toBe(
            'Jane Doe is a Staff Engineer based in Berlin, Germany. Specialises in Go. Open to new opportunities.',
        );
        expect(Array.from(el.querySelectorAll('h3')).map((h) => h.textContent)).toEqual([
            'Who is Jane Doe?',
            'What does Jane Doe specialise in?',
            'Where is Jane Doe based?',
            'Is Jane Doe available for new roles?',
        ]);
    });

    it('re-renders on a language switch (async pipe, zoneless-safe)', () => {
        const fixture = render(PROFILE);
        lang$.next('de');
        fixture.detectChanges();
        expect((fixture.nativeElement as HTMLElement).querySelector('h2')?.textContent?.trim()).toBe('Auf einen Blick');
    });

    it('renders nothing when the profile cannot support it', () => {
        const el: HTMLElement = render(null).nativeElement;
        expect(el.querySelector('[data-testid="at-a-glance"]')).toBeNull();
    });
});
