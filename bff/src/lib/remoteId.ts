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

/** Opaque, non-persistent chapter ids used by the "read without adding" preview. */
export function previewBookId(sourceId: string, sourceSeriesId: string, sourceChapterId: string): string {
  const payload = JSON.stringify({ sourceId, sourceSeriesId, sourceChapterId });
  return `preview_${Buffer.from(payload).toString('base64url')}`;
}

export function parsePreviewBookId(id: string): { sourceId: string; sourceSeriesId: string; sourceChapterId: string } | null {
  if (!id.startsWith('preview_')) return null;
  try {
    const raw = Buffer.from(id.slice('preview_'.length), 'base64url').toString('utf8');
    const value = JSON.parse(raw) as Partial<{ sourceId: string; sourceSeriesId: string; sourceChapterId: string }>;
    if (!value.sourceId || !value.sourceSeriesId || !value.sourceChapterId) return null;
    return { sourceId: value.sourceId, sourceSeriesId: value.sourceSeriesId, sourceChapterId: value.sourceChapterId };
  } catch { return null; }
}
