import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const recorderSource = fs.readFileSync('src/capture/page_capture_recorder.ts', 'utf8');
const contentSource = fs.readFileSync('src/content/content_script.ts', 'utf8');
const backgroundSource = fs.readFileSync('src/sw/qa_issue_background_service.ts', 'utf8');
const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));

test('MAIN-world recorder patches console.error/console.warn and fetch/XHR', () => {
  assert.match(recorderSource, /console\.error = \(\.\.\.args: unknown\[\]\) => \{/);
  assert.match(recorderSource, /console\.warn = \(\.\.\.args: unknown\[\]\) => \{/);
  assert.match(recorderSource, /window\.fetch = async \(\.\.\.args: Parameters<typeof fetch>\) => \{/);
  assert.match(recorderSource, /OriginalXMLHttpRequest\.prototype\.open = function/);
  assert.match(recorderSource, /OriginalXMLHttpRequest\.prototype\.send = function/);
});

test('recorder only records failed network activity (4xx/5xx or thrown/rejected)', () => {
  assert.match(recorderSource, /if \(!response\.ok\)/);
  assert.match(recorderSource, /if \(this\.status >= 400\)/);
  assert.match(recorderSource, /rejected: \$\{reason\}/);
  assert.match(recorderSource, /rejected: network error/);
});

test('recorder guards against double installation in the same page', () => {
  assert.match(recorderSource, /if \(globalWindow\.__flawferret2CaptureInstalled\) return;/);
  assert.match(recorderSource, /globalWindow\.__flawferret2CaptureInstalled = true;/);
});

test('recorder answers buffer requests via CustomEvent/DOM messaging, not a shared JS object', () => {
  assert.match(recorderSource, /window\.addEventListener\("flawferret2:capture-buffer-request", \(\) => \{/);
  assert.match(recorderSource, /new CustomEvent\("flawferret2:capture-buffer-response", \{/);
});

test('requestPageCaptureBuffer resolves with an empty buffer on timeout', () => {
  assert.match(recorderSource, /export function requestPageCaptureBuffer\(/);
  assert.match(recorderSource, /setTimeout\(\(\) => finish\(EMPTY_PAGE_CAPTURE_BUFFER\), timeoutMs\);/);
});

test('content script requests the page capture buffer before building capture context', () => {
  assert.match(
    contentSource,
    /import \{ requestPageCaptureBuffer, type PageCaptureBuffer \} from "\.\.\/capture\/page_capture_recorder\.js";/
  );
  assert.match(contentSource, /const pageCapture = await requestPageCaptureBuffer\(\);/);
  assert.match(
    contentSource,
    /buildFlawFerret2CaptureContext\(meta, notes, pageCapture\)/
  );
});

test('capture context only includes consoleErrors/networkEvents when non-empty', () => {
  assert.match(contentSource, /if \(pageCapture\.consoleErrors\.length > 0\) \{/);
  assert.match(contentSource, /captureContext\.consoleErrors = pageCapture\.consoleErrors;/);
  assert.match(contentSource, /if \(pageCapture\.networkEvents\.length > 0\) \{/);
  assert.match(contentSource, /captureContext\.networkEvents = pageCapture\.networkEvents;/);
});

test('background service injects the MAIN-world recorder alongside the ISOLATED content script', () => {
  assert.match(
    backgroundSource,
    /import \{ installPageCaptureRecorder \} from "\.\.\/capture\/page_capture_recorder\.js";/
  );
  assert.match(backgroundSource, /await injectPageCaptureRecorder\(tabId\);/);
  assert.match(backgroundSource, /world: "MAIN",/);
  assert.match(backgroundSource, /func: installPageCaptureRecorder/);
});

test('MAIN-world injection failure does not block the core capture-and-copy flow', () => {
  assert.match(
    backgroundSource,
    /async function injectPageCaptureRecorder\(tabId: number\): Promise<void> \{\s*\n\s*try \{/
  );
  assert.match(backgroundSource, /console\.warn\(\s*\n\s*"Page capture recorder injection failed:"/);
});

test('manifest keeps only the scripting permission needed for MAIN-world injection (no new permission)', () => {
  assert.ok(manifest.permissions.includes('scripting'));
  assert.deepEqual(manifest.permissions, [
    'contextMenus',
    'activeTab',
    'scripting',
    'storage',
    'tabCapture',
    'offscreen',
  ]);
});
