import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HeaderComponent } from './header.component';
import { vi, afterEach } from 'vitest';
import { Router, provideRouter } from '@angular/router';

import { LanguageService } from '@beaconfolio/shared';
import { MockLanguageService } from '@beaconfolio/shared/testing';
import { YearsService } from '../../services/years.service';
import { of } from 'rxjs';
import { provideTestBrand } from '@beaconfolio/shared/testing';

class MockYearsService {
  getYears() {
    return of([2025, 2024, 2021, 2014, 2009]);
  }
}

describe('HeaderComponent (cov2)', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let router: any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        ...provideTestBrand(),
        provideRouter([]),
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: YearsService, useClass: MockYearsService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scrollToYear should do nothing extra when neither year element nor experience section exist', fakeAsync(() => {
    // Both the [data-year] selector and #experience selector return null,
    // exercising the falsy branch of `if (experienceSection)` on line 91.
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    component.scrollToYear(1999);
    tick(500);

    expect(router.navigate).toHaveBeenCalledWith(['/'], { fragment: 'experience' });
    expect(scrollToSpy).not.toHaveBeenCalled();
  }));
});
