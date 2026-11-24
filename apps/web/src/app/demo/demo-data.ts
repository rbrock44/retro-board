import {
  BUILT_IN_TEMPLATES, CARRIED_OVER_COLUMN, DEFAULT_BOARD_SETTINGS, positionAfter,
  type ActionStatus, type AttachmentDto, type BoardSettings, type BoardStatus, type CardStatus, type ColumnDto,
  type InviteDto, type TeamRole, type TeamSettings, type TemplateDto, type UserDto, type UserPrefs,
} from '@retro/shared';

/** Everything the demo backend knows. Kept flat and JSON-safe so it can live in localStorage and in a share link. */
export interface DemoState {
  version: 1;
  meId: string;
  prefs: UserPrefs;
  users: (UserDto & { email: string })[];
  teams: { id: string; name: string; description: string; settings: TeamSettings; createdAt: string }[];
  members: { teamId: string; userId: string; role: TeamRole; joinedAt: string }[];
  invites: InviteDto[];
  templates: (TemplateDto & { teamId: string })[];
  boards: {
    id: string; teamId: string; title: string; status: BoardStatus; settings: BoardSettings;
    createdAt: string; closedAt: string | null; createdBy: string;
  }[];
  columns: ColumnDto[];
  cards: DemoCard[];
  replies: {
    id: string; cardId: string; parentId: string | null; authorId: string; body: string;
    attachmentIds: string[]; createdAt: string; editedAt: string | null;
  }[];
  attachments: Record<string, AttachmentDto>;
  votes: { boardId: string; cardId: string; userId: string; count: number }[];
  reactions: { boardId: string; targetType: 'card' | 'reply'; targetId: string; userId: string; emoji: string }[];
  actions: {
    id: string; teamId: string; boardId: string | null; cardId: string | null; title: string; ownerId: string | null;
    dueDate: string | null; status: ActionStatus; createdAt: string; completedAt: string | null;
  }[];
  /** How many cards the pretend teammates have added, so the live demo doesn't fill up forever */
  botCards: number;
}

export interface DemoCard {
  id: string; boardId: string; columnId: string; parentId: string | null; groupTitle: string | null; position: string;
  body: string; anonymous: boolean; authorId: string; status: CardStatus; carriedFromId: string | null;
  carriedToBoardId: string | null; attachmentIds: string[]; createdAt: string; editedAt: string | null;
}

export const DEMO_ME = 'demo-you';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function svgUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** A small burndown chart, drawn in SVG so the demo needs no image files. */
const BURNDOWN = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280" viewBox="0 0 480 280">
<rect width="480" height="280" rx="12" fill="#f8fafc"/>
<text x="24" y="36" font-family="system-ui,sans-serif" font-size="18" font-weight="600" fill="#0f172a">Sprint 42 burndown</text>
<g stroke="#e2e8f0">${[80, 120, 160, 200, 240].map(y => `<line x1="40" y1="${y}" x2="456" y2="${y}"/>`).join('')}</g>
<polyline fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6 6" points="40,80 456,240"/>
<polyline fill="none" stroke="#6366f1" stroke-width="4" stroke-linejoin="round" points="40,80 98,92 156,90 214,140 272,150 330,196 388,214 456,232"/>
<circle cx="456" cy="232" r="6" fill="#6366f1"/>
<text x="40" y="266" font-family="system-ui,sans-serif" font-size="12" fill="#64748b">Day 1</text>
<text x="420" y="266" font-family="system-ui,sans-serif" font-size="12" fill="#64748b">Day 10</text>
</svg>`);

/** Stands in for a GIF: an animated SVG plays the same way in an <img>. */
const PARTY = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
<rect width="320" height="200" rx="12" fill="#1e1b4b"/>
${[['#f472b6', 40, 0], ['#facc15', 100, 0.3], ['#34d399', 160, 0.6], ['#60a5fa', 220, 0.9], ['#fb923c', 280, 1.2]].map(([c, x, d]) =>
  `<circle cx="${x}" cy="60" r="12" fill="${c}"><animate attributeName="cy" values="60;140;60" dur="1.4s" begin="${d}s" repeatCount="indefinite"/></circle>`).join('')}
<text x="160" y="185" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="#fff">SHIPPED! 🎉</text>
</svg>`);

function attachment(id: string, kind: 'image' | 'gif', url: string, w: number, h: number, name: string): AttachmentDto {
  return { id, kind, mime: 'image/svg+xml', url, thumbUrl: null, width: w, height: h, size: null, name };
}

/** A fresh demo: two teams, a finished retro and a live one with every feature in use. */
export function seedDemo(now = Date.now()): DemoState {
  const ago = (days: number, hours = 0) => new Date(now - days * 86_400_000 - hours * 3_600_000).toISOString();
  const dateIn = (days: number) => new Date(now + days * 86_400_000).toISOString().slice(0, 10);

  const users: DemoState['users'] = [
    { id: DEMO_ME, name: 'You', email: 'you@example.com', avatarUrl: null, role: 'admin' },
    // Famous Iowans (from Winterset, Corning, Denison, Anamosa and Clarinda) as the sample team
    { id: 'u-alex', name: 'John Wayne', email: 'john.wayne@example.com', avatarUrl: null, role: 'user' },
    { id: 'u-sam', name: 'Johnny Carson', email: 'johnny.carson@example.com', avatarUrl: null, role: 'user' },
    { id: 'u-priya', name: 'Donna Reed', email: 'donna.reed@example.com', avatarUrl: null, role: 'user' },
    { id: 'u-jordan', name: 'Grant Wood', email: 'grant.wood@example.com', avatarUrl: null, role: 'user' },
    { id: 'u-morgan', name: 'Glenn Miller', email: 'glenn.miller@example.com', avatarUrl: null, role: 'user' },
  ];
  const team = { id: 't-platform', name: 'Corn Belt Platform', description: 'APIs, infrastructure and the deploy pipeline, out of Des Moines', settings: {}, createdAt: ago(120) };
  const team2 = { id: 't-design', name: 'Des Moines Design Crew', description: 'Product design and research', settings: { defaultTemplateId: 'mad-sad-glad' }, createdAt: ago(60) };
  const members: DemoState['members'] = [
    { teamId: team.id, userId: DEMO_ME, role: 'admin', joinedAt: ago(120) },
    ...['u-alex', 'u-sam', 'u-priya', 'u-jordan'].map(userId => ({ teamId: team.id, userId, role: 'member' as TeamRole, joinedAt: ago(100) })),
    { teamId: team.id, userId: 'u-morgan', role: 'viewer', joinedAt: ago(30) },
    { teamId: team2.id, userId: DEMO_ME, role: 'admin', joinedAt: ago(60) },
    { teamId: team2.id, userId: 'u-morgan', role: 'member', joinedAt: ago(60) },
    { teamId: team2.id, userId: 'u-priya', role: 'member', joinedAt: ago(55) },
  ];

  const s = (o: Partial<BoardSettings> = {}): BoardSettings => ({ ...DEFAULT_BOARD_SETTINGS, ...o });
  const past = { id: 'b-s41', teamId: team.id, title: `${ago(15).slice(0, 10)} · Sprint 41`, status: 'closed' as BoardStatus, settings: s(), createdAt: ago(15), closedAt: ago(15, -2), createdBy: DEMO_ME };
  const live = { id: 'b-s42', teamId: team.id, title: 'Current retro', status: 'open' as BoardStatus, settings: s(), createdAt: ago(0, 1), closedAt: null, createdBy: DEMO_ME };
  const kickoff = { id: 'b-kick', teamId: team2.id, title: 'Research kickoff', status: 'open' as BoardStatus, settings: s(), createdAt: ago(3), closedAt: null, createdBy: 'u-morgan' };

  const columns: ColumnDto[] = [];
  const addColumns = (boardId: string, specs: { title: string; color: string; description?: string }[], carried = false) => {
    let pos = positionAfter(null);
    const ids: string[] = [];
    if (carried) {
      const id = newId();
      columns.push({ id, boardId, ...CARRIED_OVER_COLUMN, description: 'Marked to carry over from earlier retros', position: pos });
      ids.push(id);
    }
    for (const spec of specs) {
      pos = positionAfter(pos);
      const id = newId();
      columns.push({ id, boardId, title: spec.title, color: spec.color, description: spec.description ?? '', position: pos });
      ids.push(id);
    }
    return ids;
  };
  const went = BUILT_IN_TEMPLATES.find(t => t.id === 'went-well')!.columns;
  const [pWell, pImprove, pIdeas] = addColumns(past.id, went);
  const [lCarried, lWell, lImprove, lIdeas] = addColumns(live.id, went, true);
  const [kMad, kSad, kGlad] = addColumns(kickoff.id, BUILT_IN_TEMPLATES.find(t => t.id === 'mad-sad-glad')!.columns);

  const cards: DemoCard[] = [];
  const lastPos = new Map<string, string | null>();
  const card = (boardId: string, columnId: string, authorId: string, body: string, extra: Partial<DemoCard> = {}, hoursAgo = 1) => {
    const position = positionAfter(lastPos.get(columnId) ?? null);
    lastPos.set(columnId, position);
    const c: DemoCard = {
      id: newId(), boardId, columnId, parentId: null, groupTitle: null, position, body, anonymous: false, authorId,
      status: 'none', carriedFromId: null, carriedToBoardId: null, attachmentIds: [], createdAt: ago(0, hoursAgo), editedAt: null, ...extra,
    };
    cards.push(c);
    return c;
  };

  // ---- Sprint 41 (closed) ----
  const p = (col: string, who: string, body: string, extra: Partial<DemoCard> = {}) => card(past.id, col, who, body, extra, 15 * 24);
  p(pWell, 'u-alex', 'Zero-downtime deploys finally work end to end');
  p(pWell, 'u-sam', 'Pairing on the auth refactor was great', { status: 'discussed' });
  p(pImprove, 'u-priya', 'Flaky integration tests cost us most of Wednesday', { status: 'resolved' });
  const carry1 = p(pImprove, 'u-jordan', 'On-call handoffs keep missing context', { status: 'carry_over', carriedToBoardId: live.id });
  const carry2 = p(pIdeas, DEMO_ME, 'Write a runbook for the payment service', { status: 'carry_over', carriedToBoardId: live.id });
  p(pIdeas, 'u-sam', 'Try a no-meeting Thursday');
  p(pWell, 'u-priya', 'Team lunch at the Maid-Rite was a great reset');

  // ---- Sprint 42 (live) ----
  card(live.id, lCarried, 'u-jordan', carry1.body, { carriedFromId: carry1.id }, 1);
  card(live.id, lCarried, DEMO_ME, carry2.body, { carriedFromId: carry2.id, status: 'discussed' }, 1);

  const ship = card(live.id, lWell, 'u-alex', 'We shipped the **new billing page** two days early 🚀', { attachmentIds: ['a-party'] });
  const burndown = card(live.id, lWell, 'u-priya', 'Burndown was the smoothest it has been all year', { attachmentIds: ['a-burndown'] });
  const reviews = card(live.id, lWell, 'u-sam', 'Code reviews came back within a day, every time');
  card(live.id, lWell, 'u-jordan', 'Thanks to everyone who covered on-call while I was out', { anonymous: true });

  const flaky = card(live.id, lImprove, 'u-sam', 'CI was red for most of Tuesday');
  const flaky2 = card(live.id, lImprove, 'u-priya', 'Integration tests are still flaky', { parentId: flaky.id, columnId: lImprove });
  const flaky3 = card(live.id, lImprove, 'u-alex', 'Nobody owns the test environment', { parentId: flaky.id, columnId: lImprove });
  flaky.groupTitle = 'Test reliability';
  const scope = card(live.id, lImprove, 'u-jordan', 'Scope changed mid-sprint twice without a heads-up', { status: 'resolved' });
  card(live.id, lImprove, DEMO_ME, 'Standups are running past 20 minutes');

  const idea1 = card(live.id, lIdeas, 'u-alex', 'Quarantine flaky tests automatically and file a ticket');
  card(live.id, lIdeas, 'u-priya', 'Demo something small every Friday');
  card(live.id, lIdeas, 'u-morgan', 'Summer offsite at the Iowa State Fair 🌽 (butter cow optional)');

  // ---- Research kickoff (another team) ----
  card(kickoff.id, kMad, 'u-morgan', 'Recruiting farmers for interviews before harvest takes weeks', {}, 70);
  card(kickoff.id, kSad, 'u-priya', 'Last round of findings never made it into the roadmap', {}, 70);
  card(kickoff.id, kGlad, DEMO_ME, 'New interview script is much tighter', {}, 70);

  const attachments: Record<string, AttachmentDto> = {
    'a-party': attachment('a-party', 'gif', PARTY, 320, 200, 'shipped.gif'),
    'a-burndown': attachment('a-burndown', 'image', BURNDOWN, 480, 280, 'burndown.svg'),
  };

  const votes: DemoState['votes'] = [];
  const vote = (c: DemoCard, userId: string, count = 1) => votes.push({ boardId: c.boardId, cardId: c.id, userId, count });
  vote(ship, 'u-sam', 2); vote(ship, 'u-priya'); vote(ship, 'u-jordan');
  vote(burndown, 'u-alex');
  vote(reviews, 'u-jordan', 2); vote(reviews, DEMO_ME);
  vote(flaky, 'u-alex', 2); vote(flaky2, 'u-jordan', 2); vote(flaky3, 'u-priya', 3); vote(flaky, DEMO_ME, 2);
  vote(scope, 'u-sam'); vote(idea1, 'u-sam', 2); vote(idea1, 'u-priya');

  const reactions: DemoState['reactions'] = [
    { boardId: live.id, targetType: 'card', targetId: ship.id, userId: 'u-sam', emoji: '🎉' },
    { boardId: live.id, targetType: 'card', targetId: ship.id, userId: 'u-jordan', emoji: '🎉' },
    { boardId: live.id, targetType: 'card', targetId: ship.id, userId: DEMO_ME, emoji: '🔥' },
    { boardId: live.id, targetType: 'card', targetId: flaky.id, userId: 'u-priya', emoji: '👀' },
  ];

  const replyId = newId();
  const replies: DemoState['replies'] = [
    { id: replyId, cardId: flaky.id, parentId: null, authorId: 'u-jordan', body: 'Most of the failures were the payments sandbox timing out.', attachmentIds: [], createdAt: ago(0, 0.8), editedAt: null },
    { id: newId(), cardId: flaky.id, parentId: replyId, authorId: 'u-alex', body: 'We could stub it in CI and run the real thing nightly.', attachmentIds: [], createdAt: ago(0, 0.6), editedAt: null },
    { id: newId(), cardId: ship.id, parentId: null, authorId: 'u-priya', body: 'Huge. Customers already noticed.', attachmentIds: [], createdAt: ago(0, 0.5), editedAt: null },
  ];

  const actions: DemoState['actions'] = [
    { id: newId(), teamId: team.id, boardId: live.id, cardId: flaky.id, title: 'Stub the payments sandbox in CI', ownerId: 'u-alex', dueDate: dateIn(5), status: 'open', createdAt: ago(0, 0.4), completedAt: null },
    { id: newId(), teamId: team.id, boardId: past.id, cardId: null, title: 'Add a deploy checklist to the wiki', ownerId: DEMO_ME, dueDate: dateIn(-3), status: 'open', createdAt: ago(15), completedAt: null },
    { id: newId(), teamId: team.id, boardId: past.id, cardId: null, title: 'Rotate the staging database credentials', ownerId: 'u-sam', dueDate: dateIn(-8), status: 'done', createdAt: ago(15), completedAt: ago(9) },
  ];

  return {
    version: 1,
    meId: DEMO_ME,
    prefs: {},
    users,
    teams: [team, team2],
    members,
    invites: [],
    templates: [{
      id: 'tpl-incident', teamId: team.id, name: 'Incident review', description: 'After an outage', builtIn: false,
      columns: [
        { title: 'What happened', color: '#ef4444' },
        { title: 'What helped', color: '#22c55e' },
        { title: 'What we change', color: '#3b82f6' },
      ],
    }],
    boards: [past, live, kickoff],
    columns,
    cards,
    replies,
    attachments,
    votes,
    reactions,
    actions,
    botCards: 0,
  };
}
