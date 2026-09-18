import { Component, Input } from '@angular/core';

import { TranslatePipe } from '@beaconfolio/shared';
import { Profile } from '../../services/profile.service';

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './recommendations.component.html',
  styleUrls: ['./recommendations.component.css'],
})
export class RecommendationsComponent {
  @Input() profile: Profile | null = null;
}
