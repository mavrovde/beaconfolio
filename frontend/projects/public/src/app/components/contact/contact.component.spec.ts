import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { ContactComponent } from './contact.component';
import { TranslatePipe } from '@beaconfolio/shared';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';
import { Profile } from '../../services/profile.service';
import { DEFAULT_SITE_CONFIG, SiteConfigService } from '../../services/site-config.service';
import { provideTestBrand } from '@beaconfolio/shared/testing';

describe('ContactComponent', () => {
  let component: ContactComponent;
  let fixture: ComponentFixture<ContactComponent>;

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

  /** Build the component with a given configured social-link list (#93). */
  async function renderWith(socialLinks: string[], profile: Profile | null = mockProfile) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ContactComponent],
      providers: [
        ...provideTestBrand(),
        {
          provide: SiteConfigService,
          useValue: { config$: of({ ...DEFAULT_SITE_CONFIG, socialLinks }) },
        },
      ],
    })
      .overrideComponent(ContactComponent, {
        remove: { imports: [TranslatePipe] },
        add: { imports: [MockTranslatePipe] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ContactComponent);
    component = fixture.componentInstance;
    component.profile = profile;
    fixture.detectChanges();
    return fixture;
  }

  const hrefs = () =>
    fixture.debugElement
      .queryAll(By.css('a[href]'))
      .map((a) => a.nativeElement.getAttribute('href'));

  beforeEach(async () => {
    await renderWith([]);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders every configured code host, including one nobody registered', async () => {
    await renderWith([
      'https://github.com/janedoe',
      'https://gitlab.com/janedoe',
      'https://bitbucket.org/janedoe',
      'https://codeberg.org/janedoe',
    ]);
    const links = hrefs();
    expect(links).toContain('https://github.com/janedoe');
    expect(links).toContain('https://gitlab.com/janedoe');
    expect(links).toContain('https://bitbucket.org/janedoe');
    expect(links).toContain('https://codeberg.org/janedoe');
    expect(fixture.nativeElement.textContent).toContain('echo $CODEBERG');
  });

  // The regression guard. A deployment that has never set SOCIAL_LINKS still
  // has a LinkedIn URL in its profile data, and it must not vanish — while a
  // deployment that HAS set it must not see LinkedIn twice.
  it('falls back to the profile LinkedIn only when nothing is configured', async () => {
    expect(hrefs()).toContain('https://linkedin.com/test');

    await renderWith(['https://linkedin.com/in/janedoe']);
    const links = hrefs();
    expect(links).toContain('https://linkedin.com/in/janedoe');
    expect(links).not.toContain('https://linkedin.com/test');
  });

  it('still renders the email in both states', async () => {
    expect(hrefs()).toContain('mailto:test@example.com');
    await renderWith(['https://github.com/janedoe']);
    expect(hrefs()).toContain('mailto:test@example.com');
  });

  it('opens outbound profiles in a new tab without handing over the opener', async () => {
    await renderWith(['https://github.com/janedoe']);
    const link = fixture.debugElement
      .queryAll(By.css('a[href]'))
      .find((a) => a.nativeElement.getAttribute('href') === 'https://github.com/janedoe');
    expect(link!.nativeElement.getAttribute('target')).toBe('_blank');
    expect(link!.nativeElement.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders no profile link at all when the configured value is unusable', async () => {
    await renderWith(['javascript:alert(1)']);
    // Assert the ALLOWLIST, not the one scheme this case feeds in. Checking
    // only `javascript:` is `js/incomplete-url-scheme-check` — `data:` and
    // `vbscript:` execute too — and it is also the weaker assertion: this is
    // what the parser actually guarantees about every href on the page.
    const rendered = hrefs();
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.every((h) => /^(https?:\/\/|mailto:)/.test(h))).toBe(true);
    // ...and the LinkedIn fallback takes over, because nothing survived.
    expect(hrefs()).toContain('https://linkedin.com/test');
  });

  it('renders nothing but the form when there is no profile', async () => {
    await renderWith(['https://github.com/janedoe'], null);
    expect(hrefs()).toEqual([]);
  });
});
