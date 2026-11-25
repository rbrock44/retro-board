import type { ActionItemDto, BoardStatus, CardDto, ColumnDto } from './models';
import { CARD_STATUS_LABELS } from './models';
import { byPosition } from './rules';

/** Everything needed to write one board into an export. */
export interface ExportBoard {
  teamName: string;
  board: { title: string; status: BoardStatus; createdAt: string };
  columns: ColumnDto[];
  cards: CardDto[];
  actions: ActionItemDto[];
}

export type ExportFormat = 'md' | 'csv';

/** "Sprint 42 retro" -> "sprint-42-retro" */
export function exportSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';
}

const who = (c: CardDto) => (c.anonymous ? 'Anonymous' : c.author?.name ?? 'Someone');
const likes = (n: number) => `${n} ${n === 1 ? 'like' : 'likes'}`;
const oneLine = (s: string) => s.replace(/\n+/g, ' ');

function boardMarkdown(b: ExportBoard, heading: '#' | '##'): string[] {
  const sub = heading === '#' ? '##' : '###';
  const md: string[] = [`${heading} ${b.board.title}`, '', `_${new Date(b.board.createdAt).toDateString()} · ${b.board.status}_`, ''];
  const all = [...b.cards].sort(byPosition);
  for (const col of [...b.columns].sort(byPosition)) {
    md.push(`${sub} ${col.title}`, '');
    const heads = all.filter(c => c.columnId === col.id && !c.parentId).sort((x, y) => y.likes - x.likes);
    if (!heads.length) md.push('_No cards_', '');
    for (const h of heads) {
      const kids = all.filter(c => c.parentId === h.id);
      const total = h.likes + kids.reduce((n, k) => n + k.likes, 0);
      const tag = h.status !== 'none' ? ` \`${CARD_STATUS_LABELS[h.status]}\`` : '';
      if (kids.length) {
        md.push(`- **${h.groupTitle ?? 'Group'}** (${likes(total)})${tag}`);
        for (const c of [h, ...kids]) md.push(`  - ${oneLine(c.body)} — ${who(c)} (${c.likes})`);
      } else {
        md.push(`- ${oneLine(h.body)} — ${who(h)} (${likes(h.likes)})${tag}`);
      }
      for (const r of [h, ...kids].flatMap(c => c.replies)) md.push(`  - ↳ ${r.author?.name ?? 'Someone'}: ${oneLine(r.body)}`);
    }
    md.push('');
  }
  md.push(`${sub} Action Items`, '');
  if (!b.actions.length) md.push('_None_');
  for (const a of b.actions) {
    md.push(`- [${a.status === 'done' ? 'x' : ' '}] ${a.title}${a.owner ? ` — @${a.owner.name}` : ''}${a.dueDate ? ` (due ${a.dueDate})` : ''}`);
  }
  md.push('');
  return md;
}

/**
 * One file for one or many boards. A single board reads as it always has; several are grouped under their team,
 * and the spreadsheet gains team and board columns.
 */
export function formatExport(boards: ExportBoard[], format: ExportFormat): string {
  const multi = boards.length > 1;
  if (format === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const where = (b: ExportBoard) => (multi ? [b.teamName, b.board.title] : []);
    const lines = [[...(multi ? ['team', 'board'] : []), 'column', 'group', 'card', 'author', 'likes', 'status', 'replies', 'created'].join(',')];
    for (const b of boards) {
      const all = [...b.cards].sort(byPosition);
      for (const col of [...b.columns].sort(byPosition)) {
        for (const c of all.filter(x => x.columnId === col.id)) {
          const head = c.parentId ? all.find(x => x.id === c.parentId) : null;
          lines.push([...where(b), col.title, head ? head.groupTitle ?? head.body.slice(0, 40) : c.groupTitle ?? '', c.body, who(c), c.likes,
            CARD_STATUS_LABELS[c.status], c.replies.length, c.createdAt].map(esc).join(','));
        }
      }
    }
    lines.push('', [...(multi ? ['team', 'board'] : []), 'action', 'owner', 'due', 'status'].join(','));
    for (const b of boards) {
      for (const a of b.actions) lines.push([...where(b), a.title, a.owner?.name ?? '', a.dueDate ?? '', a.status].map(esc).join(','));
    }
    return lines.join('\n');
  }

  if (!multi) return boardMarkdown(boards[0], '#').join('\n') ;
  const md: string[] = ['# Retro export', '', `_${boards.length} boards, exported ${new Date().toDateString()}_`, ''];
  let team = '';
  for (const b of boards) {
    if (b.teamName !== team) {
      team = b.teamName;
      md.push(`# ${team}`, '');
    }
    md.push(...boardMarkdown(b, '##'));
  }
  return md.join('\n');
}
