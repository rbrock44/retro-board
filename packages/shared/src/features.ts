/** Parts of the app an instance admin can switch off for everyone (Admin > Customize > Features). */
export type FeatureKey =
  | 'images' | 'gifs' | 'videos' | 'anonymous' | 'replies' | 'reactions' | 'likes' | 'groups'
  | 'actions' | 'carryOver' | 'export' | 'presence' | 'personShades';

export type Features = Record<FeatureKey, boolean>;

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  /** What it is, and what happens when it's off (shown behind the ⓘ) */
  info: string;
  group: 'Media' | 'Cards' | 'Retros' | 'People';
}

export const FEATURES: FeatureInfo[] = [
  { key: 'images', group: 'Media', label: 'Image Uploads',
    info: 'Pictures on cards and replies (JPG, PNG, WebP, AVIF). When off, nobody can attach images, and images already on boards are hidden and no longer served.' },
  { key: 'gifs', group: 'Media', label: 'GIFs',
    info: 'Animated GIF files, and GIF search if a Tenor key is set up. When off, GIFs can\'t be added, and ones already on boards are hidden and no longer served.' },
  { key: 'videos', group: 'Media', label: 'Video Uploads',
    info: 'MP4, WebM and MOV videos on cards and replies. When off, videos can\'t be added, and videos already on boards are hidden and no longer served: useful where video sharing isn\'t allowed.' },
  { key: 'anonymous', group: 'Cards', label: 'Anonymous Cards',
    info: 'Lets people hide their name on a card. When off, every card shows who wrote it, the Anonymous box disappears, and cards that were already anonymous stay anonymous.' },
  { key: 'replies', group: 'Cards', label: 'Replies',
    info: 'Threaded replies under cards. When off, the replies bar is hidden and no new replies can be written.' },
  { key: 'reactions', group: 'Cards', label: 'Emoji Reactions',
    info: '👍 ❤️ 😂 and friends on cards and replies. When off, reactions are hidden and can\'t be added.' },
  { key: 'likes', group: 'Cards', label: 'Likes',
    info: 'Everyone can like every card once, and boards can be sorted by Most Liked. When off, likes are hidden and can\'t be given.' },
  { key: 'groups', group: 'Cards', label: 'Groups',
    info: 'Putting related cards together with Create Group or Group Mode. When off, no new groups can be made; groups that already exist still show.' },
  { key: 'actions', group: 'Retros', label: 'Action Items',
    info: 'Follow-ups with an owner and due date that show on every board until done. When off, the Actions panel and Create Action Item are hidden.' },
  { key: 'carryOver', group: 'Retros', label: 'Carry Over',
    info: 'Marking a card Carry Over so it moves to the next board when one is archived. When off, the mark isn\'t offered and nothing moves across.' },
  { key: 'export', group: 'Retros', label: 'Export',
    info: 'Downloading past retros as Markdown or a spreadsheet, and printing them. When off, every Export button is hidden and the server refuses exports.' },
  { key: 'presence', group: 'People', label: 'Who\'s Here',
    info: 'Avatars of the people on a board right now, and "typing…" hints. When off, nobody can see who else is looking at a board or writing.' },
  { key: 'personShades', group: 'People', label: 'Color by Person',
    info: 'Gives each person\'s cards their own light shade, the same on every board, so you can tell who wrote what at a glance (anonymous cards stay neutral). When off, cards are all the same color.' },
];

export const FEATURE_KEYS = FEATURES.map(f => f.key);

export const ALL_FEATURES_ON: Features = Object.fromEntries(FEATURE_KEYS.map(k => [k, true])) as Features;

/** Known keys only, missing ones on; anything else is ignored. */
export function withFeatureDefaults(partial: unknown): Features {
  const src = (partial && typeof partial === 'object' ? partial : {}) as Record<string, unknown>;
  const out = { ...ALL_FEATURES_ON };
  for (const k of FEATURE_KEYS) if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
  return out;
}

/** "videos,gifs" (DISABLED_FEATURES in .env) -> those switched off */
export function featuresFromDisabledList(list: string | undefined): Features {
  const off = new Set((list ?? '').split(',').map(s => s.trim()).filter(Boolean));
  return Object.fromEntries(FEATURE_KEYS.map(k => [k, !off.has(k)])) as Features;
}

/** Which feature covers an attachment kind */
export const FEATURE_FOR_ATTACHMENT = { image: 'images', gif: 'gifs', video: 'videos' } as const satisfies Record<string, FeatureKey>;

export function featureLabel(key: FeatureKey): string {
  return FEATURES.find(f => f.key === key)?.label ?? key;
}
