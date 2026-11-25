import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { personHue, type UserDto } from '@retro/shared';

export const PERSON_SHADES_STORAGE_KEY = 'retro.personShades';

/**
 * "Color by Person": each author's cards get a light tint of their own hue (from their user id, so it's the
 * same everywhere). On by default; the choice is remembered per browser.
 */
@Injectable({ providedIn: 'root' })
export class PersonShades {
  private auth = inject(AuthService);
  readonly enabled = signal(this.stored());

  toggle() {
    this.set(!this.enabled());
  }

  set(on: boolean) {
    this.enabled.set(on);
    try {
      localStorage.setItem(PERSON_SHADES_STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      // storage blocked: the choice still holds for this visit
    }
  }

  /** The hue to shade this person with, or null when shades are off or there's no known person */
  hueFor(user: Pick<UserDto, 'id'> | null | undefined): number | null {
    return this.enabled() && this.auth.on('personShades') && user?.id ? personHue(user.id) : null;
  }

  private stored(): boolean {
    try {
      return localStorage.getItem(PERSON_SHADES_STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  }
}
