import type { TemplateDto } from './models';

export const BUILT_IN_TEMPLATES: TemplateDto[] = [
  {
    id: 'went-well',
    name: 'Went Well / To Improve / Actions',
    description: 'The classic three-column retro',
    builtIn: true,
    columns: [
      { title: 'Went well', color: '#22c55e' },
      { title: 'To improve', color: '#f97316' },
      { title: 'Action ideas', color: '#3b82f6' },
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
      { title: 'Longed for', color: '#a855f7' },
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

export const CARRIED_OVER_COLUMN = { title: 'Carried over', color: '#a855f7' };

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
