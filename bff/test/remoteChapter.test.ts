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
