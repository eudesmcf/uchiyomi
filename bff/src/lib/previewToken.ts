import { open, seal } from './secretbox';
import type { PreviewBookPayload } from './remoteId';

const TTL = 10 * 60_000;

type PreviewMeta = Omit<PreviewBookPayload, 'sourceId' | 'sourceSeriesId' | 'sourceChapterId' | 'signed'>;

/** Create a self-contained, authenticated handle for a read-only remote chapter preview. */
export function signedPreviewBookId(sourceId: string, sourceSeriesId: string, sourceChapterId: string, meta: PreviewMeta = {}): string {
  const payload: PreviewBookPayload = {
    sourceId,
    sourceSeriesId,
    sourceChapterId,
    ...meta,
    expiresAt: meta.expiresAt ?? Date.now() + TTL,
    signed: true,
  };
  const sealed = seal(JSON.stringify(payload));
  return `remote_src_${Buffer.from(sealed, 'utf8').toString('base64url')}`;
}

/** Decode a new signed preview id. Legacy unsigned ids are handled separately by remoteId.ts. */
export function parseSignedPreviewBookId(id: string): PreviewBookPayload | null {
  if (!id.startsWith('remote_src_')) return null;
  try {
    const sealed = Buffer.from(id.slice('remote_src_'.length), 'base64url').toString('utf8');
    const raw = open(sealed);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PreviewBookPayload>;
    if (!value.signed || !value.sourceId || !value.sourceSeriesId || !value.sourceChapterId) return null;
    return {
      sourceId: value.sourceId,
      sourceSeriesId: value.sourceSeriesId,
      sourceChapterId: value.sourceChapterId,
      seriesTitle: typeof value.seriesTitle === 'string' ? value.seriesTitle : undefined,
      sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : null,
      number: typeof value.number === 'number' ? value.number : undefined,
      title: typeof value.title === 'string' ? value.title : null,
      pages: typeof value.pages === 'number' ? value.pages : null,
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : undefined,
      signed: true,
    };
  } catch {
    return null;
  }
}
