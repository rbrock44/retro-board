// Copies the emoji picker's emoji list into public/emoji/, so the app serves it itself (no CDN). Runs before
// build and start; the copy isn't committed, so it always matches the installed emoji-picker-element-data.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const from = join(dirname(require.resolve('emoji-picker-element-data/package.json')), 'en/emojibase/data.json');
const to = join(dirname(fileURLToPath(import.meta.url)), '../public/emoji/data.json');
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
