import { one } from './db';
import { getSource, listSources, loadSuwayomiSources } from './sources';
import { cfSession } from './sources/flaresolverr';
import type { SourceAdapter, SourceSeries, SourceChapter } from './sources/types';
import type { ViewCtx } from './visibility';
import { Params, visible, sourceAllowedFor } from './visibility';
export { parseRemoteBookId, remoteBookId, parsePreviewBookId } from './remoteId';
import { isPreviewBookId, parseRemoteBookId, parsePreviewBookId } from './remoteId';
import { parseSignedPreviewBookId } from './previewToken';

export interface RemoteChapterRow {
  series_id: string;
  series_title: string;
  source_id: string;
  source_series_id: string;
  source_chapter_id: string;
  number: number;
  title: string | null;
  pages: number | null;
  published_at: string | null;
  status: string;
  error: string | null;
  source_url: string | null;
}

// A preview is intentionally not persisted in the library. Keep the exact result of the preview lookup for
// a short time so the reader uses the same chapter selected by the dialog instead of re-listing a remote source.
const previewCache = new Map<string, { expiresAt: number; row: RemoteChapterRow }>();
const PREVIEW_TTL = 10 * 60_000;

export class RemoteChapterError extends Error {
  constructor(readonly statusCode: 400 | 403 | 404 | 503, readonly code: string, message = code) {
    super(message);
  }
}

export function remoteErrorStatus(error: unknown): number {
  const status = Number((error as any)?.statusCode);
  return [400, 403, 404, 503].includes(status) ? status : 503;
}

export function remoteErrorCode(error: unknown): string {
  return typeof (error as any)?.code === 'string' ? (error as any).code : 'remote_unavailable';
}

export function rememberPreview(id: string, sourceId: string, series: SourceSeries, chapter: SourceChapter): void {
  previewCache.set(id, {
    expiresAt: Date.now() + PREVIEW_TTL,
    row: {
      series_id: id,
      series_title: series.title,
      source_id: sourceId,
      source_series_id: String(series.sourceId),
      source_chapter_id: String(chapter.sourceId),
      number: chapter.number,
      title: chapter.title || `Chapter ${chapter.number}`,
      pages: chapter.pages ?? null,
      published_at: chapter.publishedAt || null,
      status: 'preview',
      error: null,
      source_url: series.url || null,
    },
  });
}

export async function resolveRemoteChapter(ctx: ViewCtx, id: string): Promise<RemoteChapterRow | null> {
  if (isPreviewBookId(id)) {
    const preview = parseSignedPreviewBookId(id) || parsePreviewBookId(id);
    if (!preview) throw new RemoteChapterError(404, 'preview_invalid');
    if (preview.expiresAt && preview.expiresAt <= Date.now()) throw new RemoteChapterError(404, 'preview_expired');

    let source = getSource(preview.sourceId) || listSources().find((candidate) => candidate.id === preview.sourceId) || null;
    if (!source) {
      await loadSuwayomiSources().catch(() => {});
      source = getSource(preview.sourceId) || listSources().find((candidate) => candidate.id === preview.sourceId) || null;
    }
    if (!source) throw new RemoteChapterError(503, 'source_unavailable');
    if (!sourceAllowedFor(source, ctx.maxAgeRating)) throw new RemoteChapterError(403, 'adult_access_denied');

    // New tokens carry the exact chapter metadata and no longer need a process-local cache. This works after
    // a restart, in a new tab, and behind a rolling deployment where the request may reach a new process.
    if (preview.signed) {
      return {
        series_id: id,
        series_title: preview.seriesTitle || 'Preview',
        source_id: preview.sourceId,
        source_series_id: preview.sourceSeriesId,
        source_chapter_id: preview.sourceChapterId,
        number: preview.number ?? 0,
        title: preview.title || 'Preview chapter',
        pages: preview.pages ?? null,
        published_at: null,
        status: 'preview',
        error: null,
        source_url: preview.sourceUrl ?? source.base ?? null,
      };
    }

    const cached = previewCache.get(id);
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.row;
      previewCache.delete(id);
    }
    // The preview endpoint already validated this source/series/chapter combination. Do not list the remote
    // chapters again here: the opaque id is enough to route the selected chapter's pages.
    const series = await source.getSeries(preview.sourceSeriesId).catch(() => null);
    if (!series) throw new RemoteChapterError(404, 'chapter_not_available');
    return {
      series_id: id,
      series_title: series.title,
      source_id: preview.sourceId,
      source_series_id: preview.sourceSeriesId,
      source_chapter_id: preview.sourceChapterId,
      number: 0,
      title: 'Preview chapter',
      pages: null,
      published_at: null,
      status: 'preview',
      error: null,
      source_url: series.url || source.base || null,
    };
  }

  const parsed = parseRemoteBookId(id);
  const p = new Params();
  const visibleSeries = `(
    SELECT s.id, s.title, s.source_id, s.source_series_id, s.web
      FROM lib_series s
     WHERE ${visible('s', ctx, p)}
  ) sv`;
  const found = parsed ? await one<RemoteChapterRow>(
    `SELECT sc.series_id, sv.title AS series_title, sc.source_id, sv.source_series_id,
            sc.source_chapter_id, sc.number, sc.title, sc.pages, sc.published_at,
            sc.status, sc.error, sv.web AS source_url
       FROM source_chapters sc JOIN ${visibleSeries} ON sv.id = sc.series_id
      WHERE sc.series_id = ${p.add(parsed.seriesId)} AND sc.source_chapter_id = ${p.add(parsed.sourceChapterId)}`,
    p.values as any[],
  ) : null;
  if (found) return found;

  return null;
}

export function remoteSource(row: RemoteChapterRow): SourceAdapter | null {
  return getSource(row.source_id);
}

const pageCache = new Map<string, { at: number; urls: string[] }>();
const PAGE_CACHE_TTL = 5 * 60_000;

export async function remotePageUrls(row: RemoteChapterRow): Promise<string[]> {
  const src = remoteSource(row);
  if (!src) throw Object.assign(new Error('source_not_available'), { statusCode: 503 });
  const key = `${row.source_id}:${row.source_chapter_id}`;
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < PAGE_CACHE_TTL) return cached.urls;
  const urls = await src.getPageUrls(row.source_chapter_id);
  if (!urls.length) throw Object.assign(new Error('chapter_has_no_pages'), { statusCode: 404 });
  pageCache.set(key, { at: Date.now(), urls });
  return urls;
}

export async function fetchRemoteImage(url: string, src: SourceAdapter): Promise<{ buffer: Buffer; contentType: string }> {
  const u = new URL(url);
  const headers: Record<string, string> = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    referer: typeof src.imageReferer === 'function' ? src.imageReferer(url) : src.imageReferer || `${u.origin}/`,
    ...(typeof src.imageHeaders === 'function' ? src.imageHeaders(url) : src.imageHeaders ?? {}),
  };
  if (src.requiresCloudflare) {
    try {
      const session = await Promise.race([
        cfSession(url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('cf timeout')), 5000)),
      ]);
      headers.cookie = session.cookie;
      headers['user-agent'] = session.userAgent;
    } catch { /* referer-only requests work for sources whose CDN is not protected */ }
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw Object.assign(new Error(`remote image ${res.status}`), { statusCode: res.status });
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/jpeg' };
}
