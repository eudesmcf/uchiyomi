import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mangadex } from '../src/lib/sources/mangadex';

test('MangaDex chapter requests use the selected language', () => {
  const src = readFileSync(join(__dirname, '../src/lib/sources/mangadex.ts'), 'utf8');
  assert.match(src, /translatedLanguage\[\]=\$\{encodeURIComponent\(lang\)\}/);
  assert.match(src, /value === 'pt' \? 'pt-br' : value/);
  assert.match(src, /async listChapters\(seriesId, language = 'en'\)/);
  assert.equal(typeof mangadex.listChapters, 'function');
});
