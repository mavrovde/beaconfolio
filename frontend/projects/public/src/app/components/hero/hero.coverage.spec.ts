import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PLATFORM_ID } from '@angular/core';
import { HeroComponent } from './hero.component';
import { TranslatePipe } from '@beaconfolio/shared';
import { MockTranslatePipe } from '@beaconfolio/shared/testing';
import { provideTestBrand } from '@beaconfolio/shared/testing';

describe('HeroComponent (server platform)', () => {
  let component: HeroComponent;
  let fixture: ComponentFixture<HeroComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeroComponent],
      providers: [...provideTestBrand(), { provide: PLATFORM_ID, useValue: 'server' }],
    })
      .overrideComponent(HeroComponent, {
        remove: { imports: [TranslatePipe] },
        add: { imports: [MockTranslatePipe] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(HeroComponent);
    component = fixture.componentInstance;
  });

  it('returns early without scrolling when not in browser (line 21-22)', () => {
    const event = new Event('click');
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    const querySpy = vi.spyOn(document, 'querySelector');
    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    component.scrollTo('#about', event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
