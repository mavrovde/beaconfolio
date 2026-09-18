import { Pipe, PipeTransform, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { LanguageService } from '../services/language.service';
import { Subscription } from 'rxjs';

@Pipe({
  name: 'translate',
  standalone: true,
  pure: false, // Impure to trigger on language change
})
export class TranslatePipe implements PipeTransform, OnDestroy {
  private languageService = inject(LanguageService);
  private cdr = inject(ChangeDetectorRef);

  private subscription: Subscription | null = null;
  private lastValue: string = '';
  private lastKey: string = '';

  transform(key: string): string {
    if (key !== this.lastKey) {
      this.lastKey = key;
      if (this.subscription) {
        this.subscription.unsubscribe();
      }
      this.subscription = this.languageService.translate(key).subscribe((value) => {
        const changed = this.lastValue !== value;
        this.lastValue = value;
        if (changed) {
          this.cdr.markForCheck();
        }
      });
    }
    return this.lastValue || key; // Return key while loading or if not found
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }
}
