import { Injectable, inject } from '@angular/core';
import { personHue, type UserDto } from '@retro/shared';
import { AuthService } from './auth.service';

/**
 * "Color by Person": each author's cards get a light tint of their own hue (from their user id, so it's the
 * same everywhere). Switched on or off for everyone by an admin (Admin > Customize > Features).
 */
@Injectable({ providedIn: 'root' })
export class PersonShades {
  private auth = inject(AuthService);

  /** The hue to shade this person with, or null when the feature is off or there's no known person */
  hueFor(user: Pick<UserDto, 'id'> | null | undefined): number | null {
    return this.auth.on('personShades') && user?.id ? personHue(user.id) : null;
  }
}
