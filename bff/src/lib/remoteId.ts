/** Opaque chapter ids used by the owned catalog for source chapters without a local archive. */
export function remoteBookId(seriesId: string, sourceChapterId: string): string {
  return `remote_${seriesId}_${Buffer.from(String(sourceChapterId)).toString('base64url')}`;
}

export function parseRemoteBookId(id: string): { seriesId: string; sourceChapterId: string } | null {
  if (!id.startsWith('remote_')) return null;
  const rest = id.slice('remote_'.length);
  const split = rest.lastIndexOf('_');
  if (split <= 0 || split >= rest.length - 1) return null;
  try {
    const sourceChapterId = Buffer.from(rest.slice(split + 1), 'base64url').toString('utf8');
    return sourceChapterId ? { seriesId: rest.slice(0, split), sourceChapterId } : null;
  } catch {
    return null;
  }
}

export interface PreviewBookPayload {
  sourceId: string;
  sourceSeriesId: string;
  sourceChapterId: string;
  seriesTitle?: string;
  sourceUrl?: string | null;
  number?: number;
  title?: string | null;
  pages?: number | null;
  expiresAt?: number;
  signed?: boolean;
}

export function isPreviewBookId(id: string): boolean {
  return id.startsWith('preview_') || id.startsWith('remote_src_');
}

export function parsePreviewBookId(id: string): PreviewBookPayload | null {
  if (!isPreviewBookId(id)) return null;
  try {
    const prefix = id.startsWith('remote_src_') ? 'remote_src_' : 'preview_';
    const encoded = id.slice(prefix.length);
    const raw = Buffer.from(encoded, 'base64url').toString('utf8');
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PreviewBookPayload>;
    if (!value.sourceId || !value.sourceSeriesId || !value.sourceChapterId) return null;
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
      signed: false,
    };
  } catch { return null; }
}
