import type { Readable } from 'node:stream';

/**
 * Just enough of the tar format (ustar) for backups: regular files only. Readable by any tar tool, so a backup
 * can also be opened by hand.
 */

const BLOCK = 512;

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

/** One file's header block. Long names are split into ustar's prefix (155) and name (100) fields. */
function header(path: string, size: number, mtime: Date): Buffer {
  let name = path, prefix = '';
  if (Buffer.byteLength(path) > 100) {
    const cut = path.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100) throw new Error(`Name too long for a backup: ${path}`);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124);
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136);
  h.write('        ', 148); // checksum counts as spaces while it's computed
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148);
  return h;
}

/** A tar file's bytes, entry by entry. Pipe through gzip for a .tar.gz. */
export async function* tarStream(entries: AsyncIterable<{ name: string; data: Buffer }>): AsyncGenerator<Buffer> {
  const now = new Date();
  for await (const { name, data } of entries) {
    yield header(name, data.length, now);
    yield data;
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) yield Buffer.alloc(pad);
  }
  yield Buffer.alloc(BLOCK * 2);
}

/** The files in a tar stream (already un-gzipped), one at a time with their whole contents. */
export async function* untar(input: Readable): AsyncGenerator<{ name: string; data: Buffer }> {
  // Incoming chunks wait in a list and are joined once there's enough for the next piece, so a big file
  // isn't copied again on every chunk.
  const pending: Buffer[] = [];
  let have = 0;
  const take = (n: number): Buffer => {
    const all = pending.length === 1 ? pending[0] : Buffer.concat(pending, have);
    pending.length = 0;
    const rest = all.subarray(n);
    if (rest.length) pending.push(rest);
    have = rest.length;
    return all.subarray(0, n);
  };
  let want: { name: string; size: number } | null = null;
  for await (const chunk of input) {
    pending.push(chunk as Buffer);
    have += (chunk as Buffer).length;
    for (;;) {
      if (!want) {
        if (have < BLOCK) break;
        const h = take(BLOCK);
        if (h.every(b => b === 0)) continue; // end-of-archive padding
        const field = (start: number, len: number) => h.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
        const isUstar = field(257, 6).startsWith('ustar');
        const prefix = isUstar ? field(345, 155) : '';
        const name = (prefix ? prefix + '/' : '') + field(0, 100);
        const size = parseInt(field(124, 12).trim() || '0', 8);
        if (!Number.isFinite(size) || size < 0) throw new Error('This file is damaged');
        const type = field(156, 1) || '0';
        want = { name: type === '0' ? name : '', size };
      }
      const padded = want.size + ((BLOCK - (want.size % BLOCK)) % BLOCK);
      if (have < padded) break;
      const data = Buffer.from(take(padded).subarray(0, want.size));
      if (want.name) yield { name: want.name, data };
      want = null;
    }
  }
  if (want) throw new Error('This file ends too early (incomplete download?)');
}
