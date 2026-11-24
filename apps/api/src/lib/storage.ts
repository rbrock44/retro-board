import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageConfig } from '../config';

/** Where uploaded media lives. Swap drivers with STORAGE_DRIVER; keys are opaque paths like `board/<id>/<file>`. */
export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  /** size is the whole object's size, even when a byte range is requested (for Content-Range). */
  get(key: string, range?: ByteRange): Promise<{ stream: Readable; size: number | null } | null>;
  size(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
}

export interface ByteRange {
  start: number;
  end: number;
}

export function createStorage(config: StorageConfig): Storage {
  return config.driver === 's3' ? s3Storage(config) : localStorage(config.dir);
}

function localStorage(dir: string): Storage {
  const root = resolve(dir);
  const pathFor = (key: string) => {
    const p = resolve(root, key);
    if (!p.startsWith(root + sep)) throw new Error('bad storage key');
    return p;
  };
  return {
    async put(key, data) {
      const p = pathFor(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    async get(key, range) {
      const p = pathFor(key);
      try {
        const s = await stat(p);
        return { stream: createReadStream(p, range ? { start: range.start, end: range.end } : undefined), size: s.size };
      } catch {
        return null;
      }
    },
    async size(key) {
      try {
        return (await stat(pathFor(key))).size;
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

function s3Storage(config: Extract<StorageConfig, { driver: 's3' }>): Storage {
  const clientPromise = import('@aws-sdk/client-s3').then(sdk => ({
    sdk,
    client: new sdk.S3Client({
      region: config.region,
      endpoint: config.endpoint ?? undefined,
      forcePathStyle: config.forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    }),
  }));
  return {
    async put(key, data, mime) {
      const { sdk, client } = await clientPromise;
      await client.send(new sdk.PutObjectCommand({ Bucket: config.bucket, Key: key, Body: data, ContentType: mime }));
    },
    async get(key, range) {
      const { sdk, client } = await clientPromise;
      try {
        const out = await client.send(new sdk.GetObjectCommand({
          Bucket: config.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }));
        const total = out.ContentRange ? Number(out.ContentRange.split('/')[1]) : out.ContentLength;
        return { stream: out.Body as Readable, size: total ?? null };
      } catch {
        return null;
      }
    },
    async size(key) {
      const { sdk, client } = await clientPromise;
      try {
        const out = await client.send(new sdk.HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return out.ContentLength ?? null;
      } catch {
        return null;
      }
    },
    async remove(key) {
      const { sdk, client } = await clientPromise;
      await client.send(new sdk.DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}
