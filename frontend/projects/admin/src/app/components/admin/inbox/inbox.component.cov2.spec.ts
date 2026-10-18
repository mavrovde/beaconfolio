import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { InboxComponent } from './inbox.component';
import { InteractionsService, Interaction } from '../../../services/interactions.service';
import { OpportunitiesService } from '../../../services/opportunities.service';

const ROW: Interaction = {
    id: 'i1',
    source: 'contact_form',
    status: 'new',
    name: 'Rita',
    email: 'rita@a.example',
    company: 'Agency',
    message: 'Hello there',
    payload: null,
    detected_language: null,
    translated_message: null,
    translated_to: null,
    translation_status: null,
    created_at: '2026-09-05T10:00:00Z',
    updated_at: '2026-09-05T10:00:00Z',
};

/**
 * The inbox row expands from the KEYBOARD as well as the mouse (Sonar
 * Web:MouseEventWithoutKeyboardEquivalentCheck): it is focusable, Enter
 * toggles it, and Enter inside the status select does not.
 */
describe('InboxComponent — keyboard row expansion', () => {
    let fixture: ComponentFixture<InboxComponent>;
    let component: InboxComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [InboxComponent],
            providers: [
                {
                    provide: InteractionsService,
                    useValue: {
                        list: vi.fn().mockReturnValue(of({ items: [ROW], total: 1, page: 1, pages: 1 })),
                        updateStatus: vi.fn(),
                    },
                },
                { provide: OpportunitiesService, useValue: { promote: vi.fn() } },
                { provide: Router, useValue: { navigate: vi.fn() } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(InboxComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    const row = () => fixture.nativeElement.querySelector('[data-testid="row-i1"]') as HTMLTableRowElement;
    const enter = (el: Element) =>
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));

    it('is focusable and announces its expanded state', () => {
        expect(row().getAttribute('tabindex')).toBe('0');
        expect(row().getAttribute('aria-expanded')).toBe('false');
    });

    it('toggles on Enter', () => {
        enter(row());
        fixture.detectChanges();
        expect(component.expandedId).toBe('i1');
        expect(row().getAttribute('aria-expanded')).toBe('true');

        enter(row());
        expect(component.expandedId).toBeNull();
    });

    it('does not toggle on Enter inside the status select', () => {
        enter(row().querySelector('select') as HTMLSelectElement);
        expect(component.expandedId).toBeNull();
    });
});
