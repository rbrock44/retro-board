import type { Features } from './features';
export type InstanceRole = 'admin' | 'user';
export type TeamRole = 'admin' | 'member' | 'viewer';
/** open: the team's Current board. archived: in the history, read-only. */
export type BoardStatus = 'open' | 'archived';
export type CardStatus = 'none' | 'discussed' | 'resolved' | 'carry_over';
export type ActionStatus = 'open' | 'done';
export type AttachmentKind = 'image' | 'gif' | 'video';

export const TEAM_ROLES: TeamRole[] = ['admin', 'member', 'viewer'];
export const CARD_STATUSES: CardStatus[] = ['none', 'discussed', 'resolved', 'carry_over'];
export const CARD_STATUS_LABELS: Record<CardStatus, string> = {
  none: 'Unmarked',
  discussed: 'Discussed',
  resolved: 'Resolved',
  carry_over: 'Carry Over',
};

export interface ThemeTokens {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
}

export interface ThemePreference {
  /** preset id, or 'custom' when tokens were edited by hand */
  preset: string;
  tokens: ThemeTokens;
}

export interface UserPrefs {
  theme?: ThemePreference;
  /** Full-screen column view opens every reply thread (unset: on) */
  focusRepliesOpen?: boolean;
}

export interface UserDto {
  id: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  role: InstanceRole;
  /** A no-sign-in visitor; others can pick them on "Are you one of these?" */
  guest?: boolean;
  disabled?: boolean;
  createdAt?: string;
}

export interface MeDto extends UserDto {
  prefs: UserPrefs;
  identities: { provider: string; email: string | null }[];
  hasPassword: boolean;
  /** A no-sign-in visitor (AUTH_MODE=none) */
  guest: boolean;
  /** A guest who hasn't given a name yet; asked for one before their first card or reply */
  needsName: boolean;
}

/** accounts: people sign in to see anything. none: no sign-in, anyone with the URL can do everything */
export type AuthMode = 'accounts' | 'none';

export interface AuthProviderInfo {
  id: string;
  name: string;
  type: 'oidc' | 'github';
}

/** Instance-wide settings. Launch defaults come from .env; admins override them on the Customize page. */
export interface InstanceSettings {
  /** Shown in the top bar and the browser tab */
  siteName: string;
  /** The look for anyone who hasn't picked their own. null: light or dark, following each device */
  theme: ThemePreference | null;
  /** Columns a new board starts with when nobody picks a template (team setting wins) */
  defaultTemplateId: string;
  allowAnonymous: boolean;
  /** Who can create an email/password account */
  signup: 'open' | 'invite' | 'closed';
  /** What's switched on for everyone (Admin > Customize > Features) */
  features: Features;
}

export interface InstanceSettingsAdminDto {
  /** What's in effect */
  settings: InstanceSettings;
  /** What the launch settings (.env) say, i.e. what "Reset" goes back to */
  launchDefaults: InstanceSettings;
  /** Keys an admin has changed from the launch defaults */
  overridden: (keyof InstanceSettings)[];
  templates: TemplateDto[];
  /** Where this install keeps its data, for the "your data stays here" note */
  storage: { location: string | null; database: string; uploads: string };
}

export interface AuthConfigDto {
  mode: AuthMode;
  /** Public bits of the instance settings */
  site: { name: string; theme: ThemePreference | null; features: Features };
  /** PUBLIC_URL: the address people are meant to use (links that get shared are built from it) */
  publicUrl: string;
  local: { enabled: boolean; signup: 'open' | 'invite' | 'closed' };
  providers: AuthProviderInfo[];
  /** Which service the GIF button searches (GIPHY_API_KEY, else TENOR_API_KEY), or null for no GIF search.
   *  'demo' is the in-browser demo's own sample library */
  gifSearch: 'giphy' | 'tenor' | 'demo' | null;
  needsSetup: boolean;
}

export interface TeamDto {
  id: string;
  name: string;
  description: string;
  myRole: TeamRole | null;
  memberCount: number;
  /** The team's display photo, or null for its initials */
  photoUrl: string | null;
  settings: TeamSettings;
  createdAt: string;
  /** Team password: whether there is one, whether this browser can get in, and whether it's the browser that set it */
  password: TeamPasswordState;
}

export interface TeamPasswordState {
  set: boolean;
  unlocked: boolean;
  /** This browser set the password: it may set a new one without the old one */
  owner: boolean;
}

/**
 * Set once per team and applied to all its boards. Unset ones fall back to the instance's defaults.
 * (Boards used to carry their own copy of these; they now follow the team.)
 */
export interface TeamSettings {
  /** The columns a fresh board starts with */
  defaultTemplateId?: string;
  allowAnonymous?: boolean;
  /** No new or edited cards on the team's boards (likes and reactions still work) */
  locked?: boolean;
  /** The team's colors on its boards; null for the site's look */
  theme?: ThemeTokens | null;
}

/** The parts of TeamSettings that every board of the team carries */
export const TEAM_BOARD_SETTING_KEYS = ['allowAnonymous', 'locked', 'theme'] as const;

export interface TeamMemberDto {
  user: UserDto;
  role: TeamRole;
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  token: string;
  teamId: string;
  teamName?: string;
  email: string | null;
  role: TeamRole;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  createdAt: string;
}

export interface ColumnSpec {
  title: string;
  color: string;
  description?: string;
}

export interface TemplateDto {
  id: string;
  name: string;
  description: string;
  columns: ColumnSpec[];
  builtIn: boolean;
  /** Made by an instance admin, offered to every team */
  instance?: boolean;
}

export interface BoardSettings {
  allowAnonymous: boolean;
  locked: boolean;
  theme?: ThemeTokens | null;
}

export interface BoardSummaryDto {
  id: string;
  teamId: string;
  title: string;
  status: BoardStatus;
  createdAt: string;
  closedAt: string | null;
  createdBy: UserDto | null;
  cardCount: number;
  actionCount: number;
}

export interface BoardDto extends BoardSummaryDto {
  settings: BoardSettings;
}

export interface ColumnDto {
  id: string;
  boardId: string;
  title: string;
  description: string;
  color: string;
  position: string;
}

export interface AttachmentDto {
  id: string;
  kind: AttachmentKind;
  mime: string;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  name: string | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
  users: string[];
}

export interface ReplyDto {
  id: string;
  cardId: string;
  parentId: string | null;
  author: UserDto | null;
  mine: boolean;
  body: string;
  attachments: AttachmentDto[];
  reactions: ReactionSummary[];
  createdAt: string;
  editedAt: string | null;
}

export interface CarriedFromDto {
  cardId: string;
  boardId: string;
  boardTitle: string;
}

export interface CardDto {
  id: string;
  boardId: string;
  columnId: string;
  parentId: string | null;
  groupTitle: string | null;
  position: string;
  body: string;
  anonymous: boolean;
  author: UserDto | null;
  mine: boolean;
  status: CardStatus;
  /** How many people like this card (one like per person) */
  likes: number;
  /** Whether the viewer likes it */
  liked: boolean;
  attachments: AttachmentDto[];
  reactions: ReactionSummary[];
  replies: ReplyDto[];
  carriedFrom: CarriedFromDto | null;
  createdAt: string;
  editedAt: string | null;
}

export interface ActionItemDto {
  id: string;
  teamId: string;
  boardId: string | null;
  boardTitle: string | null;
  cardId: string | null;
  title: string;
  owner: UserDto | null;
  dueDate: string | null;
  status: ActionStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface BoardPermissions {
  role: TeamRole;
  canWrite: boolean;
  canVote: boolean;
  canFacilitate: boolean;
}

export interface BoardStateDto {
  board: BoardDto;
  team: { id: string; name: string; photoUrl: string | null };
  columns: ColumnDto[];
  cards: CardDto[];
  actions: ActionItemDto[];
  members: UserDto[];
  permissions: BoardPermissions;
}

export interface SearchResultDto {
  cards: { card: { id: string; body: string; status: CardStatus }; board: { id: string; title: string } }[];
  actions: ActionItemDto[];
}

export interface GifResultDto {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  title: string;
}
