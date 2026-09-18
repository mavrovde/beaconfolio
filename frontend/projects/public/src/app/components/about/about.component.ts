import { Component, Input } from '@angular/core';

import { TranslatePipe } from '@beaconfolio/shared';
import { Profile } from '../../services/profile.service';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.css'],
})
export class AboutComponent {
  @Input() profile: Profile | null = null;
}
