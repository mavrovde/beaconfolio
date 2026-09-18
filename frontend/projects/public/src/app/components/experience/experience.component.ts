import { Component, Input } from '@angular/core';

import { TranslatePipe } from '@beaconfolio/shared';
import { YearExtractPipe } from '../../pipes/year-extract.pipe';
import { Profile } from '../../services/profile.service';

@Component({
  selector: 'app-experience',
  standalone: true,
  imports: [TranslatePipe, YearExtractPipe],
  templateUrl: './experience.component.html',
  styleUrls: ['./experience.component.css'],
})
export class ExperienceComponent {
  @Input() profile: Profile | null = null;
}
