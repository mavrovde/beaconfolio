import { Component, Input, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

import { ShellChromeService, TranslatePipe } from '@beaconfolio/shared';
import { Profile } from '../../services/profile.service';
import { SiteConfigService } from '../../services/site-config.service';
import { ProfileLink, toProfileLinks } from '../../profile-links/profile-links';
import { ContactFormComponent } from './contact-form.component';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [TranslatePipe, ContactFormComponent, AsyncPipe],
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss'],
})
export class ContactComponent {
  @Input() profile: Profile | null = null;

  private siteConfig = inject(SiteConfigService);

  // Shell chrome, from config (#67). The literals these replace were
  // `user@portfolio…` — a hostname no deployment but the original owned, in a
  // template no forker should have to edit. FIELDS, not template calls: each
  // accessor returns a fresh observable, so calling one from the template
  // would re-subscribe on every change-detection pass.
  readonly prompt$ = inject(ShellChromeService).prompt();

  /**
   * Code-host and social profiles (#93), from the SAME runtime list that feeds
   * `Person.sameAs` — so what a recruiter clicks and what a crawler follows can
   * never disagree. Empty config renders nothing at all, not an empty heading.
   */
  readonly profileLinks$: Observable<ProfileLink[]> = this.siteConfig.config$.pipe(
    map((cfg) => toProfileLinks(cfg.socialLinks))
  );
}
