import { and, count, eq, inArray, type SQL } from 'drizzle-orm';
import type {
  ActionItemDto, AttachmentDto, BoardDto, CardDto, ColumnDto, ReactionSummary, ReplyDto, UserDto,
} from '@retro/shared';
import { DEFAULT_BOARD_SETTINGS } from '@retro/shared';
import { toUserDto } from '../auth/users';
import type { Db } from '../db';
import {
  actionItems, attachments, boards, cards, reactions, replies, users, votes,
  type Attachment, type Board, type Column, type User,
} from '../db/schema';
import { iso } from './http';

export function attachmentDto(a: Attachment): AttachmentDto {
  return {
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    url: a.externalUrl ?? `/api/media/${a.id}`,
    thumbUrl: a.externalPreviewUrl ?? (a.thumbKey ? `/api/media/${a.id}/thumb` : null),
    width: a.width,
    height: a.height,
    size: a.size,
    name: a.name,
  };
}

export function columnDto(c: Column): ColumnDto {
  return { id: c.id, boardId: c.boardId, title: c.title, description: c.description, color: c.color, position: c.position };
}

async function usersById(db: Db, ids: (string | null)[]): Promise<Map<string, User>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await db.select().from(users).where(inArray(users.id, unique));
  return new Map(rows.map(u => [u.id, u]));
}

function summarizeReactions(rows: { emoji: string; userId: string }[], viewerId: string, names: Map<string, User>): ReactionSummary[] {
  const by = new Map<string, ReactionSummary>();
  for (const r of rows) {
    let s = by.get(r.emoji);
    if (!s) { s = { emoji: r.emoji, count: 0, mine: false, users: [] }; by.set(r.emoji, s); }
    s.count++;
    if (r.userId === viewerId) s.mine = true;
    s.users.push(names.get(r.userId)?.name ?? 'Someone');
  }
  return [...by.values()];
}

/**
 * Loads cards with everything shown on them and returns a function that shapes them for one viewer.
 * Shaping is per viewer because anonymous authors, "mine" flags and own votes differ per person;
 * the realtime hub calls it once per connected socket.
 */
export async function loadCards(db: Db, boardId: string, cardIds?: string[]): Promise<(viewerId: string) => CardDto[]> {
  if (cardIds && !cardIds.length) return () => [];
  const where = cardIds ? and(eq(cards.boardId, boardId), inArray(cards.id, cardIds)) : eq(cards.boardId, boardId);
  const cardRows = await db.select().from(cards).where(where);
  if (!cardRows.length) return () => [];
  const ids = cardRows.map(c => c.id);

  const replyRows = await db.select().from(replies).where(inArray(replies.cardId, ids)).orderBy(replies.createdAt);
  const replyIds = replyRows.map(r => r.id);
  const replyAttach = replyIds.length
    ? await db.select().from(attachments).where(inArray(attachments.replyId, replyIds)).orderBy(attachments.createdAt)
    : [];
  const cardAttach = await db.select().from(attachments).where(inArray(attachments.cardId, ids)).orderBy(attachments.createdAt);
  const reactionRows = await db.select().from(reactions)
    .where(and(eq(reactions.boardId, boardId), inArray(reactions.targetId, [...ids, ...replyIds])));
  const voteRows = await db.select().from(votes).where(inArray(votes.cardId, ids));

  const carriedIds = cardRows.map(c => c.carriedFromId).filter((x): x is string => !!x);
  const carried = carriedIds.length
    ? await db.select({ id: cards.id, boardId: cards.boardId, boardTitle: boards.title })
        .from(cards).innerJoin(boards, eq(boards.id, cards.boardId)).where(inArray(cards.id, carriedIds))
    : [];
  const carriedMap = new Map(carried.map(c => [c.id, c]));

  const people = await usersById(db, [
    ...cardRows.map(c => c.authorId), ...replyRows.map(r => r.authorId), ...reactionRows.map(r => r.userId),
  ]);

  return (viewerId: string) => cardRows.map(c => {
    const author = c.authorId ? people.get(c.authorId) : undefined;
    const showAuthor = !c.anonymous && author;
    const cardVotes = voteRows.filter(v => v.cardId === c.id);
    const from = c.carriedFromId ? carriedMap.get(c.carriedFromId) : undefined;
    const replyDtos: ReplyDto[] = replyRows.filter(r => r.cardId === c.id).map(r => {
      const ra = r.authorId ? people.get(r.authorId) : undefined;
      return {
        id: r.id,
        cardId: r.cardId,
        parentId: r.parentId,
        author: ra ? toUserDto(ra) : null,
        mine: r.authorId === viewerId,
        body: r.body,
        attachments: replyAttach.filter(a => a.replyId === r.id).map(attachmentDto),
        reactions: summarizeReactions(reactionRows.filter(x => x.targetType === 'reply' && x.targetId === r.id), viewerId, people),
        createdAt: r.createdAt.toISOString(),
        editedAt: iso(r.editedAt),
      };
    });
    return {
      id: c.id,
      boardId: c.boardId,
      columnId: c.columnId,
      parentId: c.parentId,
      groupTitle: c.groupTitle,
      position: c.position,
      body: c.body,
      anonymous: c.anonymous,
      author: showAuthor ? toUserDto(author) : null,
      mine: c.authorId === viewerId,
      status: c.status,
      votes: cardVotes.reduce((n, v) => n + v.count, 0),
      myVotes: cardVotes.find(v => v.userId === viewerId)?.count ?? 0,
      attachments: cardAttach.filter(a => a.cardId === c.id).map(attachmentDto),
      reactions: summarizeReactions(reactionRows.filter(x => x.targetType === 'card' && x.targetId === c.id), viewerId, people),
      replies: replyDtos,
      carriedFrom: from ? { cardId: from.id, boardId: from.boardId, boardTitle: from.boardTitle } : null,
      createdAt: c.createdAt.toISOString(),
      editedAt: iso(c.editedAt),
    };
  });
}

export async function loadActions(db: Db, where: SQL | undefined): Promise<ActionItemDto[]> {
  const rows = await db
    .select({ a: actionItems, boardTitle: boards.title })
    .from(actionItems)
    .leftJoin(boards, eq(boards.id, actionItems.boardId))
    .where(where)
    .orderBy(actionItems.createdAt);
  const owners = await usersById(db, rows.map(r => r.a.ownerId));
  return rows.map(({ a, boardTitle }) => {
    const owner = a.ownerId ? owners.get(a.ownerId) : undefined;
    return {
      id: a.id,
      teamId: a.teamId,
      boardId: a.boardId,
      boardTitle: boardTitle ?? null,
      cardId: a.cardId,
      title: a.title,
      owner: owner ? toUserDto(owner) : null,
      dueDate: a.dueDate,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      completedAt: iso(a.completedAt),
    };
  });
}

export async function boardDtos(db: Db, rows: Board[]): Promise<BoardDto[]> {
  if (!rows.length) return [];
  const ids = rows.map(b => b.id);
  const cardCounts = await db.select({ boardId: cards.boardId, n: count() }).from(cards)
    .where(inArray(cards.boardId, ids)).groupBy(cards.boardId);
  const actionCounts = await db.select({ boardId: actionItems.boardId, n: count() }).from(actionItems)
    .where(inArray(actionItems.boardId, ids)).groupBy(actionItems.boardId);
  const creators = await usersById(db, rows.map(b => b.createdBy));
  return rows.map(b => {
    const creator = b.createdBy ? creators.get(b.createdBy) : undefined;
    return {
      id: b.id,
      teamId: b.teamId,
      title: b.title,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
      closedAt: iso(b.closedAt),
      createdBy: creator ? toUserDto(creator) : null,
      cardCount: Number(cardCounts.find(c => c.boardId === b.id)?.n ?? 0),
      actionCount: Number(actionCounts.find(c => c.boardId === b.id)?.n ?? 0),
      settings: { ...DEFAULT_BOARD_SETTINGS, ...b.settings },
    };
  });
}

export async function boardDto(db: Db, b: Board): Promise<BoardDto> {
  return (await boardDtos(db, [b]))[0];
}

export function memberDtos(rows: User[]): UserDto[] {
  return rows.map(u => toUserDto(u));
}
