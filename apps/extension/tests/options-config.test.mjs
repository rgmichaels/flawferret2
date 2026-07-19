import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('src/options/options.html', 'utf8');
const source = fs.readFileSync('src/options/options.ts', 'utf8');

test('options page exposes only the FlawFerret2 bootstrap URL setting', () => {
  assert.match(html, /FlawFerret2 Configuration/);
  assert.match(html, /id="ff2BaseUrl"/);
  assert.match(html, /id="saveFf2"/);
  assert.match(source, /DEFAULT_FLAWFERRET2_BASE_URL\s*=\s*"http:\/\/localhost:3000"/);
  assert.match(source, /chrome\.storage\.local\.set\(\{\s*flawFerret2Config: config\s*\}\)/);
});
