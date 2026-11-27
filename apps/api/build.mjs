// Bundles the API (and the shared package) into dist/main.js (and the server tools into dist/cli.js) and copies the SQL migrations next to it.
// Every other npm package stays external and is installed in the runtime image.
import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

const externals = {
  name: 'externals',
  setup(b) {
    b.onResolve({ filter: /^@retro\/shared$/ }, () => ({ path: shared }));
    b.onResolve({ filter: /^[^./]/ }, args =>
      args.path.startsWith('@retro/') ? undefined : { path: args.path, external: true });
  },
};

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: { main: 'src/main.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  plugins: [externals],
});
cpSync('drizzle', 'dist/drizzle', { recursive: true });
console.log('built dist/main.js and dist/cli.js');
