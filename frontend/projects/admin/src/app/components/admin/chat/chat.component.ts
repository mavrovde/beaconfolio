
import { Component, ElementRef, ViewChild, AfterViewChecked, ChangeDetectorRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LlmService, ChatMessage } from '@beaconfolio/shared';

@Component({
    selector: 'app-admin-chat',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './chat.component.html',
    styles: [`
    .chat-container {
      height: calc(100vh - 200px);
    }
  `]
})
export class AdminChatComponent implements AfterViewChecked, OnInit {
    private llmService = inject(LlmService);
    private cdr = inject(ChangeDetectorRef);

    @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

    messages: ChatMessage[] = [];
    userInput: string = '';
    isLoading: boolean = false;
    private readonly STORAGE_KEY = 'gemini_chat_history_v1';
    private readonly RETENTION_DAYS = 7;

    ngOnInit() {
        this.loadFromLocalStorage();
    }

    ngAfterViewChecked() {
        this.scrollToBottom();
    }

    scrollToBottom(): void {
        try {
            this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
        } catch { /* best-effort scroll; the container can be mid-teardown */ }
    }

    async sendMessage() {
        if (!this.userInput.trim() || this.isLoading) return;

        const userMsg: ChatMessage = { role: 'user', content: this.userInput };
        this.messages.push(userMsg);
        this.saveToLocalStorage();
        this.userInput = '';
        this.isLoading = true;

        try {
            const response = await this.llmService.chatGemini(this.messages);
            this.messages.push({ role: 'assistant', content: response });
            this.saveToLocalStorage();
        } catch (error) {
            console.error('Chat error:', error);
            this.messages.push({ role: 'assistant', content: 'Error: Failed to get response from Gemini.' });
            this.saveToLocalStorage();
        } finally {
            this.isLoading = false;
            this.cdr.detectChanges(); // Force update for E2E tests
        }
    }

    private saveToLocalStorage() {
        if (typeof localStorage === 'undefined') return;
        const data = {
            timestamp: Date.now(),
            messages: this.messages
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    }

    private loadFromLocalStorage() {
        if (typeof localStorage === 'undefined') return;
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                const age = Date.now() - parsed.timestamp;
                const maxAge = this.RETENTION_DAYS * 24 * 60 * 60 * 1000;

                if (age < maxAge) {
                    this.messages = parsed.messages || [];
                } else {
                    localStorage.removeItem(this.STORAGE_KEY);
                }
            } catch (e) {
                console.error('Failed to parse chat history', e);
                localStorage.removeItem(this.STORAGE_KEY);
            }
        }
    }
}
