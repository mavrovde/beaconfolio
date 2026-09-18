import { Component, Input } from '@angular/core';

import { TranslatePipe } from '@beaconfolio/shared';
import { Profile } from '../../services/profile.service';
import { ContactFormComponent } from './contact-form.component';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [TranslatePipe, ContactFormComponent],
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss'],
})
export class ContactComponent {
  @Input() profile: Profile | null = null;
}
