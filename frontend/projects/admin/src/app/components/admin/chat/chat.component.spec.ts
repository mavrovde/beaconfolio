import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminChatComponent } from './chat.component';
import { LlmService } from '@beaconfolio/shared';
import { FormsModule } from '@angular/forms';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('AdminChatComponent', () => {
    let component: AdminChatComponent;
    let fixture: ComponentFixture<AdminChatComponent>;
    let llmServiceMock: any;

    let localStorageMock: any;

    beforeEach(async () => {
        llmServiceMock = {
            chatGemini: vi.fn()
        };

        // Explicitly mock localStorage
        localStorageMock = {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn()
        };
        Object.defineProperty(window, 'localStorage', {
            value: localStorageMock,
            writable: true
        });

        await TestBed.configureTestingModule({
            imports: [AdminChatComponent, FormsModule],
            providers: [
                { provide: LlmService, useValue: llmServiceMock }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(AdminChatComponent);
        component = fixture.componentInstance;
        // Do not detect changes automatically
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    it('should load history from localStorage on init', () => {
        const history = {
            timestamp: Date.now(),
            messages: [{ role: 'user', content: 'History Msg' }]
        };
        localStorageMock.getItem.mockReturnValue(JSON.stringify(history));

        component.ngOnInit();

        expect(component.messages.length).toBe(1);
        expect(component.messages[0].content).toBe('History Msg');
        expect(localStorageMock.getItem).toHaveBeenCalledWith('gemini_chat_history_v1');
    });

    it('should send message, save to localStorage, and display response', async () => {
        fixture.detectChanges();
        llmServiceMock.chatGemini.mockResolvedValue('Response from Gemini');

        component.userInput = 'Hello';
        const promise = component.sendMessage();

        expect(component.messages.length).toBe(1);
        expect(component.messages[0].content).toBe('Hello');
        expect(localStorageMock.setItem).toHaveBeenCalled();
        expect(component.isLoading).toBe(true);

        await promise;

        expect(component.messages.length).toBe(2);
        expect(component.messages[1].content).toBe('Response from Gemini');
        expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
        expect(component.isLoading).toBe(false);
    });

    it('should handle error from service and save state', async () => {
        fixture.detectChanges();
        llmServiceMock.chatGemini.mockRejectedValue(new Error('Network error'));

        component.userInput = 'Hello';
        const promise = component.sendMessage();

        await promise;

        expect(component.messages.length).toBe(2);
        expect(component.messages[1].content).toContain('Error:');
        expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
        expect(component.isLoading).toBe(false);
    });

    it('should not send empty message', () => {
        component.userInput = '   ';
        component.sendMessage();
        expect(llmServiceMock.chatGemini).not.toHaveBeenCalled();
    });

    it('should scroll to bottom after view checked', () => {
        fixture.detectChanges();
        const scrollSpy = vi.spyOn(component, 'scrollToBottom');
        component.ngAfterViewChecked();
        expect(scrollSpy).toHaveBeenCalled();
    });

    it('should clear localStorage if history is expired', () => {
        const expiredTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
        const history = {
            timestamp: expiredTime,
            messages: [{ role: 'user', content: 'Old Msg' }]
        };
        localStorageMock.getItem.mockReturnValue(JSON.stringify(history));

        component.ngOnInit();

        expect(component.messages.length).toBe(0);
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('gemini_chat_history_v1');
    });
});


