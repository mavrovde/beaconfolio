import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { TranslatePipe } from '@beaconfolio/shared';
import { MockTranslatePipe, provideTestBrand } from '@beaconfolio/shared/testing';
import { HeroComponent } from './hero.component';
import { Profile } from '../../services/profile.service';

/**
 * The hero heading is what a crawler reads as the page's H1. Its accessible
 * name must be plain words — the shell prompt and cursor are decoration —
 * and it carries the short role composed from the headline.
 */
const PROFILE: Profile = {
    name: 'Jane Doe',
    headline: 'Staff Engineer @ Acme | Go, Rust | Solutions Architect',
    location: 'Berlin, Germany',
    about: '',
    experience: [],
    education: [],
    skills: [],
};

/** Text of `el` without any aria-hidden subtree — roughly its accessible name. */
function accessibleText(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('HeroComponent — heading semantics', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HeroComponent],
            providers: [provideTestBrand()],
        })
            .overrideComponent(HeroComponent, {
                remove: { imports: [TranslatePipe] },
                add: { imports: [MockTranslatePipe] },
            })
            .compileComponents();
    });

    function render(profile: Profile) {
        const fixture = TestBed.createComponent(HeroComponent);
        fixture.componentInstance.profile = profile;
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('keeps the prompt glyph and cursor out of the heading text and adds the role', () => {
        const h1 = render(PROFILE).querySelector('h1')!;
        const text = accessibleText(h1);
        expect(text).not.toContain('>');
        expect(text).toContain('Jane Doe');
        expect(text.endsWith('Staff Engineer & Solutions Architect')).toBe(true);
        expect(h1.querySelector('.terminal-cursor')?.getAttribute('aria-hidden')).toBe('true');
        expect(h1.querySelector('[data-testid="hero-role"]')?.textContent).toBe('Staff Engineer & Solutions Architect');
    });

    it('renders no role line when the headline names none', () => {
        const h1 = render({ ...PROFILE, headline: '' }).querySelector('h1')!;
        expect(h1.querySelector('[data-testid="hero-role"]')).toBeNull();
    });

    it('gives the LCP portrait intrinsic dimensions and high fetch priority', () => {
        const img = render(PROFILE).querySelector('[data-testid="profile-photo"]')!;
        expect(img.getAttribute('width')).toBe('160');
        expect(img.getAttribute('height')).toBe('160');
        expect(img.getAttribute('fetchpriority')).toBe('high');
        expect(img.getAttribute('alt')).toBe('Jane Doe');
    });
});
