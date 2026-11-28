import { Injectable, signal } from '@angular/core';

export interface LockedTeam {
  id: string;
  name: string;
  /** A private board with its own password, rather than a team */
  board?: boolean;
}

/**
 * Set when the server answers 423 (a team password this browser hasn't typed): the app then shows the password
 * prompt in place of the page. The root component clears it on the next navigation, so leaving just works.
 * (No Router here: the API client depends on this, and the Router depends on the API client.)
 */
@Injectable({ providedIn: 'root' })
export class TeamLockService {
  readonly locked = signal<LockedTeam | null>(null);
}
