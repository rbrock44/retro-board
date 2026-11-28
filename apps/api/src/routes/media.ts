import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import { FEATURE_FOR_ATTACHMENT, type AttachmentKind, type GifResultDto } from '@retro/shared';
import type { Ctx } from '../context';
import { attachments, teams } from '../db/schema';
import { dropUnusedFiles } from '../lib/file-cleanup';
import { canEditOwn, requireBoard, requireTeam } from '../lib/access';
import { HttpError, badRequest, forbidden, noContent, notFound, parse, requireUser } from '../lib/http';
import { featureOn, requireFeature } from '../lib/instance';
import { newId } from '../lib/ids';
import { attachmentDto } from '../lib/serialize';
import { teamDto } from './teams';

const IMAGE_FORMATS: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
  gif: { mime: 'image/gif', ext: 'gif' },
  heif: { mime: 'image/avif', ext: 'avif' },
};

/** Recognises mp4/mov (ISO base media "ftyp") and webm/mkv (EBML) by their first bytes, never by the claimed type. */
export function sniffVideo(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    return brand.startsWith('qt') ? { mime: 'video/quicktime', ext: 'mov' } : { mime: 'video/mp4', ext: 'mp4' };
  }
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return { mime: 'video/webm', ext: 'webm' };
  return null;
}

const GIF_HOSTS = /(^|\.)(tenor\.com|giphy\.com)$/;

type GiphyImage = { url: string; width: string; height: string };

/** Giphy search, or what's trending for an empty query. Rated PG-13 at most, like Tenor's "medium" filter. */
export async function giphySearch(key: string, q: string, fetcher: typeof fetch = fetch): Promise<GifResultDto[]> {
  const url = new URL(q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
  url.searchParams.set('api_key', key);
  if (q) url.searchParams.set('q', q);
  url.searchParams.set('limit', '24');
  url.searchParams.set('rating', 'pg-13');
  url.searchParams.set('bundle', 'messaging_non_clips');
  const res = await fetcher(url);
  if (!res.ok) throw new HttpError(502, 'GIF search is unavailable right now');
  const data = (await res.json()) as { data: { id: string; title: string; images: Record<string, GiphyImage | undefined> }[] };
  return data.data.filter(g => g.images.original?.url).map(g => {
    const full = g.images.original!;
    // fixed_width is a small, fast-loading copy for the picker grid
    const small = g.images.fixed_width ?? full;
    return {
      id: g.id,
      url: full.url,
      previewUrl: small.url,
      width: Math.min(4000, Number(full.width) || 0),
      height: Math.min(4000, Number(full.height) || 0),
      title: g.title,
    };
  });
}

export async function mediaRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, storage, config } = ctx;

  app.post('/api/boards/:boardId/attachments', async req => {
    const user = requireUser(req);
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'write');
    const file = await req.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
    if (!file) throw badRequest('No file was sent');
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      throw new HttpError(413, `Files can be at most ${Math.round(config.maxUploadBytes / 1048576)} MB`);
    }

    const id = newId();
    const base = `boards/${board.id}/${id}`;
    let kind: AttachmentKind;
    let mime: string;
    let width: number | null = null;
    let height: number | null = null;
    let key: string;
    let thumbKey: string | null = null;
    let stored: Buffer = buf;

    const video = sniffVideo(buf);
    if (video) {
      await requireFeature(ctx, 'videos');
      kind = 'video';
      mime = video.mime;
      key = `${base}.${video.ext}`;
    } else {
      let meta: Metadata;
      try {
        meta = await sharp(buf, { animated: true }).metadata();
      } catch {
        throw badRequest('Only images (jpg, png, webp, gif, avif) and videos (mp4, webm, mov) can be attached');
      }
      const fmt = meta.format ? IMAGE_FORMATS[meta.format] : undefined;
      if (!fmt) throw badRequest(`${meta.format ?? 'That'} images are not supported`);
      mime = fmt.mime;
      width = meta.width ?? null;
      height = meta.pageHeight ?? meta.height ?? null;
      key = `${base}.${fmt.ext}`;
      if (meta.format === 'gif') {
        await requireFeature(ctx, 'gifs');
        kind = 'gif';
      } else {
        await requireFeature(ctx, 'images');
        kind = 'image';
        // Re-encode to drop EXIF (GPS, camera details) and bake in the rotation.
        const img = sharp(buf).rotate();
        stored = meta.format === 'jpeg' ? await img.jpeg({ quality: 88 }).toBuffer()
          : meta.format === 'png' ? await img.png().toBuffer()
          : meta.format === 'webp' ? await img.webp({ quality: 88 }).toBuffer()
          : buf;
        if ((width ?? 0) > 800 || (height ?? 0) > 800) {
          thumbKey = `${base}.thumb.webp`;
          await storage.put(thumbKey, await sharp(stored).resize(800, 800, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(), 'image/webp');
        }
        if (meta.orientation && meta.orientation >= 5) [width, height] = [height, width];
      }
    }

    await storage.put(key, stored, mime);
    const [row] = await db.insert(attachments).values({
      id, boardId: board.id, uploaderId: user.id, kind, mime, storageKey: key, thumbKey,
      width, height, size: stored.length, name: file.filename?.slice(0, 200) ?? null,
    }).returning();
    return attachmentDto(row);
  });

  app.post('/api/boards/:boardId/attachments/gif', async req => {
    const user = requireUser(req);
    await requireFeature(ctx, 'gifs');
    const { board } = await requireBoard(db, user, (req.params as { boardId: string }).boardId, 'write');
    const body = parse(z.object({
      url: z.string().url().max(1000),
      previewUrl: z.string().url().max(1000).optional(),
      width: z.number().int().min(1).max(4000).optional(),
      height: z.number().int().min(1).max(4000).optional(),
      title: z.string().max(200).optional(),
    }), req.body);
    for (const u of [body.url, body.previewUrl].filter(Boolean) as string[]) {
      const parsed = new URL(u);
      if (parsed.protocol !== 'https:' || !GIF_HOSTS.test(parsed.hostname)) throw badRequest('Only Tenor and Giphy GIF links can be embedded');
    }
    const [row] = await db.insert(attachments).values({
      id: newId(), boardId: board.id, uploaderId: user.id, kind: 'gif', mime: 'image/gif',
      externalUrl: body.url, externalPreviewUrl: body.previewUrl ?? null,
      width: body.width ?? null, height: body.height ?? null, name: body.title ?? null,
    }).returning();
    return attachmentDto(row);
  });

  app.get('/api/gifs', async (req): Promise<GifResultDto[]> => {
    requireUser(req);
    await requireFeature(ctx, 'gifs');
    const q = String((req.query as { q?: string }).q ?? '').trim().slice(0, 100);
    if (config.giphyApiKey) return giphySearch(config.giphyApiKey, q);
    if (!config.tenorApiKey) throw notFound('GIF search');
    const url = new URL(q ? 'https://tenor.googleapis.com/v2/search' : 'https://tenor.googleapis.com/v2/featured');
    if (q) url.searchParams.set('q', q);
    url.searchParams.set('key', config.tenorApiKey);
    url.searchParams.set('client_key', 'retro-board');
    url.searchParams.set('limit', '24');
    url.searchParams.set('media_filter', 'gif,tinygif');
    url.searchParams.set('contentfilter', 'medium');
    const res = await fetch(url);
    if (!res.ok) throw new HttpError(502, 'GIF search is unavailable right now');
    const data = (await res.json()) as {
      results: { id: string; content_description: string; media_formats: Record<string, { url: string; dims: [number, number] }> }[];
    };
    return data.results.filter(r => r.media_formats.gif).map(r => ({
      id: r.id,
      url: r.media_formats.gif.url,
      previewUrl: (r.media_formats.tinygif ?? r.media_formats.gif).url,
      width: r.media_formats.gif.dims[0],
      height: r.media_formats.gif.dims[1],
      title: r.content_description,
    }));
  });

  async function serve(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, thumb: boolean) {
    const user = requireUser(req);
    const [a] = await db.select().from(attachments).where(eq(attachments.id, (req.params as { id: string }).id));
    if (!a) throw notFound('File');
    await requireBoard(db, user, a.boardId, 'read');
    // A kind of media an admin has switched off isn't served, including what was uploaded before
    if (!(await featureOn(ctx, FEATURE_FOR_ATTACHMENT[a.kind]))) throw notFound('File');
    if (a.externalUrl) return reply.redirect(thumb && a.externalPreviewUrl ? a.externalPreviewUrl : a.externalUrl);
    const key = thumb && a.thumbKey ? a.thumbKey : a.storageKey;
    if (!key) throw notFound('File');
    const mime = thumb && a.thumbKey ? 'image/webp' : a.mime;

    reply.header('content-type', mime)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('accept-ranges', 'bytes');

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const total = await storage.size(key);
      if (total === null) throw notFound('File');
      let start = range[1] ? Number(range[1]) : total - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : total - 1;
      start = Math.max(0, start);
      end = Math.min(total - 1, end);
      if (start > end) return reply.code(416).header('content-range', `bytes */${total}`).send();
      const got = await storage.get(key, { start, end });
      if (!got) throw notFound('File');
      return reply.code(206).header('content-range', `bytes ${start}-${end}/${total}`)
        .header('content-length', end - start + 1).send(got.stream);
    }
    const got = await storage.get(key);
    if (!got) throw notFound('File');
    if (got.size !== null) reply.header('content-length', got.size);
    return reply.send(got.stream);
  }

  // ---- team photo: any image, stored as a 256px square webp (re-encoding drops EXIF and anything hidden in it) ----

  app.post('/api/teams/:teamId/photo', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'admin');
    const file = await req.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
    if (!file) throw badRequest('No file was sent');
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      throw new HttpError(413, `Files can be at most ${Math.round(config.maxUploadBytes / 1048576)} MB`);
    }
    let meta: Metadata;
    try {
      meta = await sharp(buf).metadata();
    } catch {
      throw badRequest('A team photo has to be an image (jpg, png, webp, gif or avif)');
    }
    if (!meta.format || !IMAGE_FORMATS[meta.format]) throw badRequest(`${meta.format ?? 'That'} images are not supported`);
    const photo = await sharp(buf).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    const key = `teams/${team.id}/${newId()}.webp`;
    await storage.put(key, photo, 'image/webp');
    const [updated] = await db.update(teams).set({ photoKey: key }).where(eq(teams.id, team.id)).returning();
    if (team.photoKey) await storage.remove(team.photoKey).catch(() => undefined);
    return teamDto(ctx, updated, user);
  });

  app.delete('/api/teams/:teamId/photo', async req => {
    const user = requireUser(req);
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'admin');
    const [updated] = await db.update(teams).set({ photoKey: null }).where(eq(teams.id, team.id)).returning();
    if (team.photoKey) await storage.remove(team.photoKey).catch(() => undefined);
    return teamDto(ctx, updated, user);
  });

  app.get('/api/teams/:teamId/photo', async (req, reply) => {
    const user = requireUser(req);
    // shown on the team's tile and its password prompt, so no password needed
    const { team } = await requireTeam(db, user, (req.params as { teamId: string }).teamId, 'viewer', { skipPassword: true });
    const got = team.photoKey ? await storage.get(team.photoKey) : null;
    if (!got) throw notFound('Photo');
    reply.header('content-type', 'image/webp')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=31536000, immutable');
    if (got.size !== null) reply.header('content-length', got.size);
    return reply.send(got.stream);
  });

  app.get('/api/media/:id', (req, reply) => serve(req, reply, false));
  app.get('/api/media/:id/thumb', (req, reply) => serve(req, reply, true));

  app.delete('/api/attachments/:id', async (req, reply) => {
    const user = requireUser(req);
    const [a] = await db.select().from(attachments).where(eq(attachments.id, (req.params as { id: string }).id));
    if (!a) throw notFound('File');
    const bctx = await requireBoard(db, user, a.boardId, 'write');
    if (!canEditOwn(bctx, a.uploaderId, user.id)) throw forbidden();
    await db.delete(attachments).where(eq(attachments.id, a.id));
    // carried-over cards share files with the original, so only files nobody else points at go
    await dropUnusedFiles(ctx, [a.storageKey, a.thumbKey]);
    if (a.cardId) {
      const { broadcastCards } = await import('./boards');
      await broadcastCards(ctx, a.boardId, [a.cardId]);
    }
    return noContent(reply);
  });
}
