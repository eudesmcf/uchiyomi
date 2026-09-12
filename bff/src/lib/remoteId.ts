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
