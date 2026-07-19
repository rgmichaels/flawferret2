import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/sw/qa_issue_background_service.ts', 'utf8');

test('context menu label matches product name', () => {
  assert.match(source, /title:\s*"FlawFerret"/);
});

test('context menu handler performs on-demand content script injection', () => {
  assert.match(source, /chrome\.scripting\.executeScript\(/);
  assert.match(source, /capture-and-copy/);
});

test('recording flow re-injects content script after tab navigation', () => {
  assert.match(source, /chrome\.tabs\.onUpdated\.addListener\(/);
  assert.match(source, /if \(changeInfo\.status !== "complete"\) return;/);
  assert.match(source, /if \(!recordingState\.recordingActive\) return;/);
  assert.match(source, /if \(recordingState\.tabId !== tabId\) return;/);
  assert.match(source, /void injectContentScript\(tabId\);/);
});

test('background handles lightweight usage metric tracking', () => {
  assert.match(source, /if \(message\?\.type === "metrics:track"\)/);
  assert.match(source, /void handleMetricsTrack\(message\)\.then\(sendResponse\);/);
  assert.match(source, /chrome\.storage\.local\.get\("usageMetrics"\)/);
});
