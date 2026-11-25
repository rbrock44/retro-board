import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

export interface TourStep {
  /** Page to be on for this step (navigated to first). /teams/<id> lands on that team's current board. */
  route?: string;
  /** What to highlight. Steps with no target (or a target that isn't there) show as a centered card. */
  target?: string;
  title: string;
  body: string;
  /** Optional link under the text */
  link?: { href: string; label: string };
}

const SEEN_KEY = 'retro-board-tour-seen';

/** The demo's guided tour: one feature at a time, highlighted on the real page. */
export const TOUR_STEPS: TourStep[] = [
  {
    route: '/',
    title: 'Welcome to Retro Board 👋',
    body: 'This is a live demo with sample teams and retros. Everything works, and anything you change is saved in this browser only. This tour takes about a minute; use the arrow keys or the buttons.',
  },
  {
    route: '/', target: 'a.team-tile',
    title: 'Teams',
    body: 'Each team has its own boards, history, action items and people. Clicking a team opens its current board.',
  },
  {
    route: '/teams/t-platform', target: '.columns',
    title: 'The Current Board',
    body: 'Columns fill the screen. Facilitators add, rename, recolor and reorder them, or start from templates like Start / Stop / Continue.',
  },
  {
    route: '/teams/t-platform', target: 'form.composer',
    title: 'Add a Card',
    body: 'Write in markdown, paste or drag in images, GIFs and videos, and tick Anonymous to hide your name. Everyone sees it appear instantly.',
  },
  {
    route: '/teams/t-platform', target: 'button.likes',
    title: 'Likes',
    body: 'Everyone can like every card, once. Sort by "Most Liked" to see what the team cares about.',
  },
  {
    route: '/teams/t-platform', target: '.group-box',
    title: 'Groups',
    body: 'Related cards sit together under one name. Use a card\'s ⋯ → Create Group, or click ⧉ at the top of a column for Group Mode and drag one card onto another.',
  },
  {
    route: '/teams/t-platform', target: '.card-menu-btn',
    title: 'Mark, Carry Over, Act',
    body: 'Mark a card Discussed, Resolved or Carry over, turn it into an action item with an owner and due date, or group it.',
  },
  {
    route: '/teams/t-platform', target: '.replies-toggle',
    title: 'Replies',
    body: 'Click the bar under a card to open threaded replies. Replies can have pictures and reactions too.',
  },
  {
    route: '/teams/t-platform', target: '.presence',
    title: 'Live, Together',
    body: 'See who\'s on the board right now. In this demo a few pretend teammates are here: watch them like and add cards.',
  },
  {
    route: '/teams/t-platform', target: '[data-tour="actions"]',
    title: 'Action Items',
    body: 'Every open action item from the team shows here, on every board, until it\'s done.',
  },
  {
    route: '/teams/t-platform', target: '[data-tour="save"]',
    title: 'Save Board',
    body: 'When the retro is over, save it to the team\'s history under today\'s date. A fresh board takes its place, and cards marked Carry over come along.',
  },
  {
    route: '/teams/t-platform', target: '.crumbs a',
    title: 'History',
    body: 'Every saved board is kept and searchable. Open any of them to look back.',
  },
  {
    route: '/teams/t-platform', target: '[data-tour="board-settings"]',
    title: 'Board Settings',
    body: 'Lock the board, allow or hide anonymous cards, and give one board its own colors.',
  },
  {
    route: '/admin', target: 'app-customize',
    title: 'Make It Yours',
    body: 'Admins set the site name, a theme and colors for everyone, default columns, templates every team can use, and who can sign up. Everyone can still pick their own theme.',
  },
  {
    target: '[data-tour="share"]',
    title: 'Share This Demo',
    body: 'Set up a demo the way you like, then Share copies a link with all of it inside. Whoever opens it gets their own copy.',
  },
  {
    route: '/',
    title: 'Run Your Own',
    body: 'The real thing runs on your own computer or server with one command, and all its data stays there.',
    link: { href: 'https://github.com/rbrock44/retro-board#readme', label: 'Get It on GitHub' },
  },
];

@Injectable({ providedIn: 'root' })
export class TourService {
  private router = inject(Router);
  readonly steps = TOUR_STEPS;
  readonly index = signal<number | null>(null);

  get active() {
    return this.index() !== null;
  }

  /** Has this browser seen (or skipped) the tour? */
  seen(): boolean {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return true;
    }
  }

  markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // private mode: it'll offer again next time, which is fine
    }
  }

  start() {
    this.markSeen();
    void this.go(0);
  }

  next() {
    const i = this.index();
    if (i === null) return;
    if (i >= this.steps.length - 1) this.end();
    else void this.go(i + 1);
  }

  back() {
    const i = this.index();
    if (i) void this.go(i - 1);
  }

  end() {
    this.index.set(null);
    this.lastRoute = null;
  }

  /** The page the last step asked for. Team pages redirect to their current board, so compare with this, not the URL. */
  private lastRoute: string | null = null;

  private async go(i: number) {
    const route = this.steps[i].route;
    if (route && route !== this.lastRoute) {
      await this.router.navigateByUrl(route);
      this.lastRoute = route;
    }
    this.index.set(i);
  }
}
