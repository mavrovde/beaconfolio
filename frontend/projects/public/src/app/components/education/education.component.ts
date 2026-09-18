import { Component, Input } from '@angular/core';

import { TranslatePipe } from '@beaconfolio/shared';
import { Profile } from '../../services/profile.service';

@Component({
  selector: 'app-education',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './education.component.html',
  styleUrls: ['./education.component.css'],
})
export class EducationComponent {
  @Input() profile: Profile | null = null;
}
