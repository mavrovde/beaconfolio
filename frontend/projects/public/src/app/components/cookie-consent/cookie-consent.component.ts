import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@beaconfolio/shared';
import { StorageService } from '@beaconfolio/shared';

@Component({
    selector: 'app-cookie-consent',
    standalone: true,
    imports: [CommonModule, TranslatePipe],
    templateUrl: './cookie-consent.component.html',
    styleUrls: ['./cookie-consent.component.css'],
})
export class CookieConsentComponent {
    private storageService = inject(StorageService);

    isVisible = false;

    constructor() {
        this.isVisible = !this.storageService.isDecisionMade();
    }

    accept() {
        this.storageService.setConsent(true);
        this.isVisible = false;
    }

    decline() {
        this.storageService.setConsent(false);
        this.isVisible = false;
    }
}
