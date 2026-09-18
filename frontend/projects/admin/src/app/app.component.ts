import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BrandAssetsService, ThemeService } from '@beaconfolio/shared';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet></router-outlet>`,
})
export class AppComponent implements OnInit {
  private themeService = inject(ThemeService);
  private brandAssets = inject(BrandAssetsService);

  ngOnInit() {
    // The preset theme (#67 AC1). The admin console imports the same shared
    // stylesheet as the public site, so it has the same five `[data-theme]`
    // blocks — but nothing was stamping the attribute here, which is why #339
    // left the console green on every preset.
    //
    // No stream is passed and this app provides no `SITE_BRAND_SOURCE`:
    // unlike the public app, admin has no site-config fetch of its own to ride
    // on, so the shared `SiteBrandService` makes ONE narrow request to the
    // PUBLIC config endpoint — the login screen has to be branded before
    // anyone has authenticated. Both calls below share that one request.
    this.themeService.initialize();
    // Favicon and webfont (#67): the console shares the public site's tab
    // icon, so a forker who points one config value at their own favicon gets
    // both surfaces, with no second value and no template edit.
    this.brandAssets.initialize();
  }
}
