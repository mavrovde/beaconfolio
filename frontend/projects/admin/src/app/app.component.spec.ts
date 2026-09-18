import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterOutlet, provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideSharedEnvironment } from '@beaconfolio/shared';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppComponent } from './app.component';
import { environment } from '../environments/environment';

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    document.documentElement.removeAttribute('data-theme');
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideSharedEnvironment(environment),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  /** The theme fetch fires on every creation; answer it so `verify()` is
   *  asserting "nothing UNEXPECTED", not "nothing at all". */
  const answerConfig = (theme?: string) =>
    http
      .expectOne(`${environment.apiUrl}${environment.apiPrefix}/config/site`)
      .flush(theme === undefined ? {} : { theme });

  it('should create the app', () => {
    expect(component).toBeTruthy();
    answerConfig();
  });

  it('should render a router-outlet', () => {
    const outlet = fixture.debugElement.query(By.directive(RouterOutlet));
    expect(outlet).toBeTruthy();
    answerConfig();
  });

  // #67 AC1: one config value restyles BOTH apps. The admin console imports
  // the same shared stylesheet, so all it needs is the attribute — and before
  // this, nothing stamped it, which is why #339's presets stopped at the
  // public site.
  it('stamps the default theme immediately, before the config request answers', () => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('terminal');
    answerConfig();
  });

  it('upgrades to the configured preset when the config lands', () => {
    answerConfig('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  // The login screen renders before anyone authenticates; an unreachable
  // backend must leave it themed with the default, not unthemed.
  it('keeps the default when the config request fails', () => {
    http
      .expectOne(`${environment.apiUrl}${environment.apiPrefix}/config/site`)
      .flush('nope', { status: 503, statusText: 'Service Unavailable' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('terminal');
  });
});
