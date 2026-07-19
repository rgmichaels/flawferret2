import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/content/content_script.ts', 'utf8');

test('overlay header title is branded as FlawFerret', () => {
  assert.match(source, /headerTitle\.textContent\s*=\s*"FlawFerret"/);
  assert.doesNotMatch(source, /Copied to clipboard/);
});

test('capture flow does not auto-write to clipboard', () => {
  assert.doesNotMatch(source, /await\s+writeClipboard\(/);
  assert.doesNotMatch(source, /async function writeClipboard\(/);
});

test('footer no longer includes Copy button action', () => {
  assert.doesNotMatch(source, /footerActions\.appendChild\(copyButton\)/);
  assert.doesNotMatch(source, /const copyButton = document\.createElement\("button"\)/);
});

test('missing Jira project validation uses red error color', () => {
  assert.match(source, /jiraStatus\.style\.color\s*=\s*"#c62828"/);
  assert.match(source, /jiraStatus\.textContent\s*=\s*"Choose Jira project"/);
});

test('overlay exposes share action after issue creation and tracks it', () => {
  assert.match(source, /shareActionButton\.textContent\s*=\s*"Copy Share Update"/);
  assert.match(source, /type:\s*"metrics:track"/);
  assert.match(source, /event:\s*"share_packet_copied"/);
});

test('overlay opens FlawFerret2 with captured Playwright context', () => {
  assert.match(source, /DEFAULT_FLAWFERRET2_BASE_URL\s*=\s*"http:\/\/localhost:3000"/);
  assert.match(source, /addPlaywrightTestButton\.textContent\s*=\s*"Add Playwright Test"/);
  assert.match(source, /chrome\.storage\.local\.get\("flawFerret2Config"\)/);
  assert.match(source, /new URL\("\/jobs\/new", baseUrl\)/);
  assert.match(source, /searchParams\.set\("captureContext"/);
  assert.match(source, /locatorCandidates:\s*meta\.selectors\.map/);
});
