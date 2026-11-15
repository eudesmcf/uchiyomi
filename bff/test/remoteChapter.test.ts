import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteBookId, remoteBookId } from '../src/lib/remoteId';

test('remote chapter ids round-trip series ids and source ids', () => {
  const id = remoteBookId('s_6d3ccfd4e49c3d408d15', 'OGUxYjNiOTUtOTU2MC00MTY0LWE5NjctMTk5ZDRiMGJjZjk4');
  assert.deepEqual(parseRemoteBookId(id), {
    seriesId: 's_6d3ccfd4e49c3d408d15',
    sourceChapterId: 'OGUxYjNiOTUtOTU2MC00MTY0LWE5NjctMTk5ZDRiMGJjZjk4',
  });
});

test('malformed remote ids are rejected', () => {
  assert.equal(parseRemoteBookId('remote_bad'), null);
  assert.equal(parseRemoteBookId('b_local_book'), null);
});

test('preview ids are authenticated, self-contained and tamper-resistant', async () => {
  process.env.JWT_SECRET = 'test-preview-secret-which-is-long-enough';
  process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
  process.env.KOMGA_BASE_URL = 'http://komga:25600';
  const { signedPreviewBookId, parseSignedPreviewBookId } = await import('../src/lib/previewToken');
  const id = signedPreviewBookId('sw:adult', '1463', '108', {
    seriesTitle: 'Preview title', number: 1, title: 'Chapter 1', pages: 12,
  });
  const parsed = parseSignedPreviewBookId(id);
  assert.equal(parsed?.sourceId, 'sw:adult');
  assert.equal(parsed?.sourceSeriesId, '1463');
  assert.equal(parsed?.sourceChapterId, '108');
  assert.equal(parsed?.seriesTitle, 'Preview title');
  assert.equal(parsed?.number, 1);
  assert.equal(parsed?.title, 'Chapter 1');
  assert.equal(parsed?.pages, 12);
  assert.equal(parsed?.signed, true);
  assert.ok((parsed?.expiresAt || 0) > Date.now());
  assert.equal(parseSignedPreviewBookId(`${id.slice(0, -1)}x`), null);
});
