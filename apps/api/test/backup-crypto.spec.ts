import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptFile, encryptFile, isEncrypted } from '../src/lib/backup-crypto';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe('encrypted backups', () => {
  it('round-trips, and refuses a wrong passphrase or a changed file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rb-enc-'));
    const plain = join(dir, 'b.tar.gz'), enc = join(dir, 'b.tar.gz.enc'), back = join(dir, 'back.tar.gz');
    const data = randomBytes(300_000);
    await writeFile(plain, data);

    await encryptFile(plain, enc, 'correct horse');
    expect(await isEncrypted(enc)).toBe(true);
    expect(await isEncrypted(plain)).toBe(false);
    const sealed = await readFile(enc);
    expect(sealed.includes(data.subarray(0, 64))).toBe(false);

    await decryptFile(enc, back, 'correct horse');
    expect((await readFile(back)).equals(data)).toBe(true);

    await rm(back);
    await expect(decryptFile(enc, back, 'wrong horse')).rejects.toThrow(/Wrong passphrase/);
    await expect(readFile(back)).rejects.toThrow(); // nothing half-decrypted left behind

    sealed[sealed.length - 100] ^= 1;
    await writeFile(enc, sealed);
    await expect(decryptFile(enc, back, 'correct horse')).rejects.toThrow(/Wrong passphrase|changed/);
    await expect(encryptFile(plain, enc, 'short')).rejects.toThrow(/8 characters/);
  });
});
