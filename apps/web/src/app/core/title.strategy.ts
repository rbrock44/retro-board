import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';
import { AuthService } from './auth.service';

/** Route titles end in "Retro Board"; this swaps in the site name an admin chose. */
@Injectable({ providedIn: 'root' })
export class SiteTitleStrategy extends TitleStrategy {
  private auth = inject(AuthService);
  private title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot) {
    this.title.setTitle(this.auth.withSiteName(this.buildTitle(snapshot) ?? 'Retro Board'));
  }
}
