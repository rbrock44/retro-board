export type InstanceRole = 'admin' | 'user';
export type TeamRole = 'admin' | 'member' | 'viewer';
export type BoardStatus = 'open' | 'closed' | 'archived';
export type CardStatus = 'none' | 'discussed' | 'resolved' | 'carry_over';
export type ActionStatus = 'open' | 'done';
export type AttachmentKind = 'image' | 'gif' | 'video';

export const TEAM_ROLES: TeamRole[] = ['admin', 'member', 'viewer'];
export const CARD_STATUSES: CardStatus[] = ['none', 'discussed', 'resolved', 'carry_over'];
export const CARD_STATUS_LABELS: Record<CardStatus, string> = {
  none: 'Unmarked',
  discussed: 'Discussed',
  resolved: 'Resolved',
  carry_over: 'Carry over',
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
}

export interface UserDto {
  id: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  role: InstanceRole;
  disabled?: boolean;
  createdAt?: string;
}

export interface MeDto extends UserDto {
  prefs: UserPrefs;
  identities: { provider: string; email: string | null }[];
  hasPassword: boolean;
}

export interface AuthProviderInfo {
  id: string;
  name: string;
  type: 'oidc' | 'github';
}

export interface AuthConfigDto {
  local: { enabled: boolean; signup: 'open' | 'invite' | 'closed' };
  providers: AuthProviderInfo[];
  gifSearch: boolean;
  needsSetup: boolean;
}

export interface TeamDto {
  id: string;
  name: string;
  description: string;
  myRole: TeamRole | null;
  memberCount: number;
  settings: TeamSettings;
  createdAt: string;
}

export interface TeamSettings {
  defaultTemplateId?: string;
  votesPerUser?: number;
  maxVotesPerCard?: number;
  anonymousByDefault?: boolean;
}

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
}

export interface BoardSettings {
  allowAnonymous: boolean;
  votesPerUser: number;
  maxVotesPerCard: number;
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
  votes: number;
  myVotes: number;
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
  team: { id: string; name: string };
  columns: ColumnDto[];
  cards: CardDto[];
  actions: ActionItemDto[];
  members: UserDto[];
  permissions: BoardPermissions;
  myVotesUsed: number;
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
