import type { GifResultDto } from '@retro/shared';

/**
 * The demo's GIF library. There's no server (and no Giphy key) in the demo, so these stand in for search results:
 * animated SVGs, which play like GIFs in an <img> and need no files or network.
 */

const W = 240;
const H = 160;

function svgUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

type Motion = 'bounce' | 'pulse' | 'wobble' | 'rise' | 'cross' | 'spin';

/** One big emoji doing `motion` above a caption, on a colored card */
function gif(bg: string, emoji: string, caption: string, motion: Motion, dur = 1.2): string {
  const anim = {
    bounce: `<animateTransform attributeName="transform" type="translate" values="0 0;0 -22;0 0" dur="${dur}s" repeatCount="indefinite"/>`,
    pulse: `<animateTransform attributeName="transform" type="scale" values="1;1.3;1" dur="${dur}s" repeatCount="indefinite"/>`,
    wobble: `<animateTransform attributeName="transform" type="rotate" values="-14;14;-14" dur="${dur}s" repeatCount="indefinite"/>`,
    rise: `<animateTransform attributeName="transform" type="translate" values="0 40;0 -40" dur="${dur}s" repeatCount="indefinite"/>`,
    cross: `<animateTransform attributeName="transform" type="translate" values="-150 0;150 0" dur="${dur}s" repeatCount="indefinite"/>`,
    spin: `<animateTransform attributeName="transform" type="rotate" values="0;360" dur="${dur}s" repeatCount="indefinite"/>`,
  }[motion];
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" rx="12" fill="${bg}"/>
<g transform="translate(${W / 2} 72)"><g>${anim}<text y="20" text-anchor="middle" font-size="58">${emoji}</text></g></g>
<text x="${W / 2}" y="146" text-anchor="middle" font-family="system-ui,sans-serif" font-size="19" font-weight="800" fill="#fff" letter-spacing="1">${caption}</text>
</svg>`);
}

/** Confetti dots bouncing in turn: the "shipped" GIF on the demo board */
export const PARTY_GIF = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
<rect width="320" height="200" rx="12" fill="#1e1b4b"/>
${([['#f472b6', 40, 0], ['#facc15', 100, 0.3], ['#34d399', 160, 0.6], ['#60a5fa', 220, 0.9], ['#fb923c', 280, 1.2]] as const).map(([c, x, d]) =>
  `<circle cx="${x}" cy="60" r="12" fill="${c}"><animate attributeName="cy" values="60;140;60" dur="1.4s" begin="${d}s" repeatCount="indefinite"/></circle>`).join('')}
<text x="160" y="185" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="#fff">SHIPPED! 🎉</text>
</svg>`);

interface DemoGif extends GifResultDto { tags: string }

const entry = (id: string, title: string, tags: string, url: string, width = W, height = H): DemoGif =>
  ({ id, title, tags, url, previewUrl: url, width, height });

export const DEMO_GIFS: DemoGif[] = [
  entry('g-party', 'Shipped!', 'party celebrate shipped release launch confetti yay', PARTY_GIF, 320, 200),
  entry('g-ship', 'Ship it', 'ship it rocket launch release deploy go', gif('#4338ca', '🚀', 'SHIP IT', 'rise', 1.4)),
  entry('g-nice', 'Nice', 'nice thumbs up good great yes agree ok', gif('#0f766e', '👍', 'NICE', 'pulse')),
  entry('g-fire', 'On fire', 'fire hot on fire amazing great streak', gif('#c2410c', '🔥', 'ON FIRE', 'pulse', 0.6)),
  entry('g-fine', 'This is fine', 'this is fine fire chaos panic incident ok', gif('#9a3412', '🔥🙂🔥', 'THIS IS FINE', 'wobble', 2)),
  entry('g-facepalm', 'Facepalm', 'facepalm oops mistake sigh ugh fail', gif('#7c2d12', '🤦', 'FACEPALM', 'wobble', 0.9)),
  entry('g-coffee', 'Need coffee', 'coffee tired monday morning sleepy', gif('#78350f', '☕', 'NEED COFFEE', 'bounce', 1.6)),
  entry('g-hmm', 'Hmm…', 'hmm thinking think wonder question unsure', gif('#334155', '🤔', 'HMM…', 'wobble', 2.2)),
  entry('g-bug', 'It\'s a bug', 'bug broken error flaky test fail', gif('#166534', '🐛', 'IT\'S A BUG', 'cross', 3)),
  entry('g-clap', 'Applause', 'applause clap bravo well done congrats thanks', gif('#be185d', '👏', 'APPLAUSE', 'pulse', 0.5)),
  entry('g-mind', 'Mind blown', 'mind blown wow amazing shocked surprise', gif('#6d28d9', '🤯', 'MIND BLOWN', 'pulse', 0.9)),
  entry('g-highfive', 'High five', 'high five team win yay celebrate together', gif('#1d4ed8', '🙌', 'HIGH FIVE', 'bounce', 0.8)),
  entry('g-slow', 'So slow', 'slow snail waiting build ci pipeline loading', gif('#4d7c0f', '🐌', 'SO SLOW', 'cross', 6)),
  entry('g-done', 'Done', 'done check finished complete resolved yes', gif('#15803d', '✅', 'DONE', 'pulse', 1)),
  entry('g-loading', 'Loading…', 'loading waiting spinner wait slow', gif('#475569', '⏳', 'LOADING…', 'spin', 2)),
];

/** Like a real GIF search: every word has to match the title or tags. An empty query is "trending" (all of them). */
export function searchDemoGifs(q: string): GifResultDto[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return DEMO_GIFS
    .filter(g => words.every(w => `${g.title} ${g.tags}`.toLowerCase().includes(w)))
    .map(({ tags: _, ...g }) => g);
}
