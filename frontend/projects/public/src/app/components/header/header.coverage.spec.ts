import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PLATFORM_ID } from '@angular/core';
import { HeaderComponent } from './header.component';
import { Router, provideRouter } from '@angular/router';
import { LanguageService } from '@beaconfolio/shared';
import { MockLanguageService } from '@beaconfolio/shared/testing';
import { provideTestBrand } from '@beaconfolio/shared/testing';

describe('HeaderComponent (server platform)', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        ...provideTestBrand(),
        provideRouter([]),
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  it('navigates home with fragment when not in browser (lines 43-45)', () => {
    const event = new Event('click');
    component.scrollTo('#experience', event);
    expect(router.navigate).toHaveBeenCalledWith(['/'], { fragment: 'experience' });
  });
});
