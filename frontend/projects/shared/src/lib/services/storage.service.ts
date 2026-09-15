import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root',
})
export class StorageService {
    private readonly CONSENT_KEY = 'cookie_consent';
    private consentSubject: BehaviorSubject<boolean>;
    consent$: Observable<boolean>;
    private isBrowser: boolean;

    constructor(@Inject(PLATFORM_ID) private platformId: object) {
        this.isBrowser = isPlatformBrowser(this.platformId);
        this.consentSubject = new BehaviorSubject<boolean>(this.hasConsented());
        this.consent$ = this.consentSubject.asObservable();
    }

    /**
     * Checks if the user has explicitly consented to cookies.
     */
    hasConsented(): boolean {
        if (!this.isBrowser) return false;
        return localStorage.getItem(this.CONSENT_KEY) === 'true';
    }

    /**
     * Checks if the user has made a decision (either accepted or declined).
     */
    isDecisionMade(): boolean {
        if (!this.isBrowser) return false;
        return localStorage.getItem(this.CONSENT_KEY) !== null;
    }

    /**
     * Sets the user's consent status.
     * @param granted True if consent is granted, false otherwise.
     */
    setConsent(granted: boolean): void {
        if (this.isBrowser) {
            localStorage.setItem(this.CONSENT_KEY, String(granted));
        }
        this.consentSubject.next(granted);

        if (!granted) {
            this.clearNonEssentialStorage();
        }
    }

    /**
     * Saves an item to local storage if consent is granted.
     * @param key The key to save.
     * @param value The value to save.
     */
    setItem(key: string, value: string): void {
        if (this.isBrowser && this.hasConsented()) {
            localStorage.setItem(key, value);
        }
    }

    /**
     * Retrieves an item from local storage.
     * @param key The key to retrieve.
     */
    getItem(key: string): string | null {
        if (!this.isBrowser) return null;
        return localStorage.getItem(key);
    }

    /**
     * Removes an item from local storage.
     * @param key The key to remove.
     */
    removeItem(key: string): void {
        if (this.isBrowser) {
            localStorage.removeItem(key);
        }
    }

    /**
     * Clears non-essential data if consent is revoked.
     * Keeps the consent decision itself.
     */
    private clearNonEssentialStorage(): void {
        if (!this.isBrowser) return;
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key !== this.CONSENT_KEY) {
                keysToRemove.push(key);
            }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
    }
}
