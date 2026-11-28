import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/**
 * Passphrase-encrypted backup files, so a copy kept off the server (another drive, R2, …) is unreadable
 * without the passphrase. AES-256-GCM with a key from scrypt; GCM's tag catches a wrong passphrase and any
 * tampering. Layout: MAGIC, 16-byte salt, 12-byte IV, the encrypted file, 16-byte tag.
 */
const MAGIC = Buffer.from('RBENC1\n');
const SALT = 16, IV = 12, TAG = 16;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function keyFor(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(passphrase.normalize('NFC'), salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function isEncrypted(path: string): Promise<boolean> {
  const f = await open(path, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await f.read(head, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && head.equals(MAGIC);
  } finally {
    await f.close();
  }
}

export async function encryptFile(input: string, output: string, passphrase: string) {
  if (passphrase.length < 8) throw new Error('The passphrase needs at least 8 characters');
  const salt = randomBytes(SALT), iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', await keyFor(passphrase, salt), iv);
  const out = createWriteStream(output);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(input), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
}

export async function decryptFile(input: string, output: string, passphrase: string) {
  const size = (await stat(input)).size;
  const f = await open(input, 'r');
  const head = Buffer.alloc(MAGIC.length + SALT + IV), tag = Buffer.alloc(TAG);
  try {
    if (size < head.length + TAG) throw new Error("That isn't an encrypted Retro Board backup");
    await f.read(head, 0, head.length, 0);
    await f.read(tag, 0, TAG, size - TAG);
  } finally {
    await f.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("That isn't an encrypted Retro Board backup");
  const salt = head.subarray(MAGIC.length, MAGIC.length + SALT), iv = head.subarray(MAGIC.length + SALT);
  const decipher = createDecipheriv('aes-256-gcm', await keyFor(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(input, { start: head.length, end: size - TAG - 1 }), decipher, createWriteStream(output));
  } catch {
    // nothing half-decrypted is left behind
    await rm(output, { force: true });
    throw new Error('Wrong passphrase, or the file was changed or cut short');
  }
}
