import { one } from './db';
import { getSource } from './sources';
import { cfSession } from './sources/flaresolverr';
import type { SourceAdapter } from './sources/types';
import type { ViewCtx } from './visibility';
import { Params, visible } from './visibility';
export { parseRemoteBookId, remoteBookId } from './remoteId';
import { parseRemoteBookId } from './remoteId';

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

export async function resolveRemoteChapter(ctx: ViewCtx, id: string): Promise<RemoteChapterRow | null> {
  const parsed = parseRemoteBookId(id);
  if (!parsed) return null;
  const p = new Params();
  const series = `(
    SELECT s.id, s.title, s.source_id, s.source_series_id, s.web
      FROM lib_series s
     WHERE ${visible('s', ctx, p)}
  ) sv`;
  return one<RemoteChapterRow>(
    `SELECT sc.series_id, sv.title AS series_title, sc.source_id, sv.source_series_id,
            sc.source_chapter_id, sc.number, sc.title, sc.pages, sc.published_at,
            sc.status, sc.error, sv.web AS source_url
       FROM source_chapters sc JOIN ${series} ON sv.id = sc.series_id
      WHERE sc.series_id = ${p.add(parsed.seriesId)} AND sc.source_chapter_id = ${p.add(parsed.sourceChapterId)}`,
    p.values as any[],
  );
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
