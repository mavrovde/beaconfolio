import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { HeroComponent } from './hero.component';
import { SiteConfigService } from '../../services/site-config.service';
import { Profile } from '../../services/profile.service';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';

import { TranslatePipe } from '@beaconfolio/shared';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';

describe('HeroComponent', () => {
  let component: HeroComponent;
  let fixture: ComponentFixture<HeroComponent>;

  const mockProfile: Profile = {
    name: 'Test Name',
    headline: 'Test Headline',
    location: 'Test Location',
    about: '',
    contact: { email: 'test@example.com', linkedin: 'https://linkedin.com/test' },
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
    recommendations: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeroComponent],
    })
      .overrideComponent(HeroComponent, {
        remove: { imports: [TranslatePipe] },
        add: { imports: [MockTranslatePipe] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HeroComponent);
    component = fixture.componentInstance;
    component.profile = mockProfile;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the runtime photo URL until the API errors (#333)', () => {
    const img = fixture.debugElement.query(By.css('[data-testid="profile-photo"]'))
      .nativeElement as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(component.photoUrl);
    expect(component.photoUrl).toContain('/profile/photo');
  });

  it('falls back to the baked placeholder on img error (#333)', () => {
    const imgDe = fixture.debugElement.query(By.css('[data-testid="profile-photo"]'));
    imgDe.triggerEventHandler('error', new Event('error'));
    fixture.detectChanges();
    const img = imgDe.nativeElement as HTMLImageElement;
    expect(component.photoFailed).toBe(true);
    expect(img.getAttribute('src')).toBe('assets/images/profile.png');
  });

  it('create', () => {
    expect(component).toBeTruthy();
  });

  it('should display profile name', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Test Name');
  });

  it('should display headline', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Test Headline');
  });

  it('should display location', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Test Location');
  });

  it('active scrollTo should prevent default behavior and scroll', () => {
    const event = new Event('click');
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    // Mock document.querySelector
    const mockElement = document.createElement('div');
    vi.spyOn(mockElement, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(document, 'querySelector').mockReturnValue(mockElement);

    // Mock window.scrollTo
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => { });

    component.scrollTo('#about', event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(document.querySelector).toHaveBeenCalledWith('#about');
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 20, // 100 (pos) + 0 (scrollY) - 80 (offset)
      behavior: 'smooth',
    });
  });

  it('scrollTo should do nothing if element is not found', () => {
    const event = new Event('click');
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => { });

    component.scrollTo('#non-existent', event);

    expect(document.querySelector).toHaveBeenCalledWith('#non-existent');
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('scrollTo should return early if not in browser environment', () => {
    const serverComponent = new HeroComponent(
      'server', // Any non-browser string works; Angular checks it strictly under the hood
      { config$: of({ availability: 'listening' }) } as unknown as SiteConfigService,
    );
    
    const event = new Event('click');
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    const querySpy = vi.spyOn(document, 'querySelector');
    
    serverComponent.scrollTo('#about', event);
    
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
  });
});
