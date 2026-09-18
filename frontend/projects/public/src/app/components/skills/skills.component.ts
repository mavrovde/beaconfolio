import { Component, Input } from '@angular/core';

import { TranslatePipe } from '@beaconfolio/shared';
import { Profile } from '../../services/profile.service';

@Component({
  selector: 'app-skills',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './skills.component.html',
  styleUrls: ['./skills.component.css'],
})
export class SkillsComponent {
  @Input() profile: Profile | null = null;
}
