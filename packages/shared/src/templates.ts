import type { TemplateDto } from './models';

export const BUILT_IN_TEMPLATES: TemplateDto[] = [
  {
    id: 'went-well',
    name: 'Went Well / To Improve / Actions',
    description: 'The classic three-column retro',
    builtIn: true,
    columns: [
      { title: 'Went Well', color: '#22c55e' },
      { title: 'To Improve', color: '#f97316' },
      { title: 'Action Ideas', color: '#3b82f6' },
    ],
  },
  {
    id: 'start-stop-continue',
    name: 'Start / Stop / Continue',
    description: 'What should the team begin, end and keep doing?',
    builtIn: true,
    columns: [
      { title: 'Start', color: '#22c55e' },
      { title: 'Stop', color: '#ef4444' },
      { title: 'Continue', color: '#3b82f6' },
    ],
  },
  {
    id: 'mad-sad-glad',
    name: 'Mad / Sad / Glad',
    description: 'Sort the sprint by how it felt',
    builtIn: true,
    columns: [
      { title: 'Mad', color: '#ef4444' },
      { title: 'Sad', color: '#6366f1' },
      { title: 'Glad', color: '#eab308' },
    ],
  },
  {
    id: '4ls',
    name: '4Ls',
    description: 'Liked, Learned, Lacked, Longed for',
    builtIn: true,
    columns: [
      { title: 'Liked', color: '#22c55e' },
      { title: 'Learned', color: '#06b6d4' },
      { title: 'Lacked', color: '#f97316' },
      { title: 'Longed For', color: '#a855f7' },
    ],
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    description: 'Wind pushes us, anchors hold us, rocks are risks, the island is the goal',
    builtIn: true,
    columns: [
      { title: 'Wind', color: '#06b6d4' },
      { title: 'Anchors', color: '#64748b' },
      { title: 'Rocks', color: '#ef4444' },
      { title: 'Island', color: '#22c55e' },
    ],
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'One empty column, build your own',
    builtIn: true,
    columns: [{ title: 'Notes', color: '#64748b' }],
  },
];

export const CARRIED_OVER_COLUMN = { title: 'Carried Over', color: '#a855f7' };

/** What a team's fresh board is called (after Archive Board, or when a team has no board yet) */
export const CURRENT_BOARD_TITLE = 'Current';
/** What it was called before; open boards with this name are renamed on start-up / load */
export const OLD_CURRENT_BOARD_TITLE = 'Current retro';

/** Column titles match regardless of case, so boards from before the Title Case change still line up. */
export function sameColumnTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function isCarriedOverColumn(title: string): boolean {
  return sameColumnTitle(title, CARRIED_OVER_COLUMN.title);
}

/** Built-in column titles from before they were Title Case, and what they are now (for older saved data). */
export const RENAMED_COLUMN_TITLES: Record<string, string> = {
  'Went well': 'Went Well', 'To improve': 'To Improve', 'Action ideas': 'Action Ideas', 'Longed for': 'Longed For',
  'Carried over': 'Carried Over',
};

/** Swatches offered next to every color picker. */
export const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b', '#78716c',
];

export const DEFAULT_BOARD_SETTINGS = {
  allowAnonymous: true,
  locked: false,
  theme: null,
};

export const REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '🤔', '😢', '🔥', '👀'];
