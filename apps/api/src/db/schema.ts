import { sql } from 'drizzle-orm';
import {
  boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  ActionStatus, AttachmentKind, BoardSettings, BoardStatus, CardStatus, ColumnSpec, InstanceRole, TeamRole,
  TeamSettings, UserPrefs,
} from '@retro/shared';

const id = () => text('id').primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  email: text('email'),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash'),
  role: text('role').$type<InstanceRole>().notNull().default('user'),
  disabled: boolean('disabled').notNull().default(false),
  /** Created by AUTH_MODE=none; name is '' until they enter one. */
  guest: boolean('guest').notNull().default(false),
  prefs: jsonb('prefs').$type<UserPrefs>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, t => [uniqueIndex('users_email_idx').on(t.email)]);

/** One row per external login linked to a user (OIDC subject, GitHub id, …). */
export const identities = pgTable('identities', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  email: text('email'),
  createdAt: createdAt(),
}, t => [uniqueIndex('identities_provider_subject_idx').on(t.provider, t.subject)]);

/** id is the sha256 of the cookie token, so a database leak does not leak live sessions. */
export const sessions = pgTable('sessions', {
  id: id(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
});

export const teams = pgTable('teams', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  settings: jsonb('settings').$type<TeamSettings>().notNull().default(sql`'{}'::jsonb`),
  /** The team's display photo in storage: a square webp, re-encoded on upload */
  photoKey: text('photo_key'),
  /** Team password (argon2): everyone needs it to see the team's boards. Null: no password */
  passwordHash: text('password_hash'),
  /** Bumped on every password change, which signs every unlocked browser out */
  passwordVersion: integer('password_version').notNull().default(0),
  /** sha256 of the key kept by the browser that set the password: it may always get in and set a new one */
  ownerKeyHash: text('owner_key_hash'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const teamMembers = pgTable('team_members', {
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<TeamRole>().notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.teamId, t.userId] }), index('team_members_user_idx').on(t.userId)]);

export const invites = pgTable('invites', {
  id: id(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  email: text('email'),
  role: text('role').$type<TeamRole>().notNull().default('member'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  revoked: boolean('revoked').notNull().default(false),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [uniqueIndex('invites_token_idx').on(t.token)]);

export const templates = pgTable('templates', {
  id: id(),
  /** null: an instance template, offered to every team */
  teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  columns: jsonb('columns').$type<ColumnSpec[]>().notNull(),
  createdAt: createdAt(),
});

export const boards = pgTable('boards', {
  id: id(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').$type<BoardStatus>().notNull().default('open'),
  settings: jsonb('settings').$type<BoardSettings>().notNull(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  /** Private (hidden): kept out of the team's lists; opened by its link, by its creator, or by team admins */
  private: boolean('private').notNull().default(false),
  /** The private link's code; replacing it (and bumping linkVersion) cuts off everyone who came by the old one */
  shareToken: text('share_token').unique(),
  linkVersion: integer('link_version').notNull().default(0),
  /** A private board's own password (its creator never types it) */
  passwordHash: text('password_hash'),
  passwordVersion: integer('password_version').notNull().default(0),
}, t => [index('boards_team_idx').on(t.teamId, t.createdAt)]);

/**
 * Who opened a private board's link (at which link version), and which version of its password they typed.
 * Team admins and the creator get in without a link; they get a row only once they type the password.
 */
export const boardAccess = pgTable('board_access', {
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  linkVersion: integer('link_version'),
  passwordVersion: integer('password_version'),
}, t => [primaryKey({ columns: [t.boardId, t.userId] }), index('board_access_user_idx').on(t.userId)]);

export const columns = pgTable('columns', {
  id: id(),
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  color: text('color').notNull(),
  position: text('position').notNull(),
}, t => [index('columns_board_idx').on(t.boardId)]);

export const cards = pgTable('cards', {
  id: id(),
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  columnId: text('column_id').notNull().references(() => columns.id, { onDelete: 'cascade' }),
  /** Set when this card is grouped under another card (the group head). */
  parentId: text('parent_id'),
  groupTitle: text('group_title'),
  position: text('position').notNull(),
  body: text('body').notNull(),
  anonymous: boolean('anonymous').notNull().default(false),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  status: text('status').$type<CardStatus>().notNull().default('none'),
  /** The card on an earlier board this one was carried over from. */
  carriedFromId: text('carried_from_id'),
  /** Set on the original once it has been carried into a later board, so it is carried only once. */
  carriedToBoardId: text('carried_to_board_id'),
  createdAt: createdAt(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
}, t => [index('cards_board_idx').on(t.boardId), index('cards_parent_idx').on(t.parentId)]);

export const replies = pgTable('replies', {
  id: id(),
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  createdAt: createdAt(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
}, t => [index('replies_card_idx').on(t.cardId)]);

export const attachments = pgTable('attachments', {
  id: id(),
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  cardId: text('card_id').references(() => cards.id, { onDelete: 'cascade' }),
  replyId: text('reply_id').references(() => replies.id, { onDelete: 'cascade' }),
  uploaderId: text('uploader_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').$type<AttachmentKind>().notNull(),
  mime: text('mime').notNull(),
  storageKey: text('storage_key'),
  thumbKey: text('thumb_key'),
  externalUrl: text('external_url'),
  externalPreviewUrl: text('external_preview_url'),
  width: integer('width'),
  height: integer('height'),
  size: integer('size'),
  name: text('name'),
  createdAt: createdAt(),
}, t => [index('attachments_board_idx').on(t.boardId)]);

/** Likes: one row per person per card, `count` is always 1 (the table predates likes and kept its name). */
export const votes = pgTable('votes', {
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  count: integer('count').notNull().default(1),
}, t => [primaryKey({ columns: [t.cardId, t.userId] }), index('votes_board_user_idx').on(t.boardId, t.userId)]);

export const reactions = pgTable('reactions', {
  id: id(),
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  targetType: text('target_type').$type<'card' | 'reply'>().notNull(),
  targetId: text('target_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: createdAt(),
}, t => [
  uniqueIndex('reactions_unique_idx').on(t.targetType, t.targetId, t.userId, t.emoji),
  index('reactions_board_idx').on(t.boardId),
]);

export const actionItems = pgTable('action_items', {
  id: id(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  boardId: text('board_id').references(() => boards.id, { onDelete: 'set null' }),
  cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
  dueDate: text('due_date'),
  status: text('status').$type<ActionStatus>().notNull().default('open'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, t => [index('action_items_team_idx').on(t.teamId, t.status)]);

export type User = typeof users.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Reply = typeof replies.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type ActionItem = typeof actionItems.$inferSelect;
export type Team = typeof teams.$inferSelect;

/** Admin overrides of the instance settings (one row). Launch defaults come from the environment. */
export const instanceSettings = pgTable('instance_settings', {
  id: text('id').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
