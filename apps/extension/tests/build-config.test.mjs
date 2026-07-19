import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const buildSource = fs.readFileSync('build.mjs', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

test('build script only bumps manifest version when explicitly requested', () => {
  assert.match(buildSource, /const shouldBumpVersion = process\.argv\.includes\("--bump-version"\);/);
  assert.match(buildSource, /writeManifest\(shouldBumpVersion\);/);
  assert.match(buildSource, /await ctx\.watch\(\);\s*\n\s*writeManifest\(false\);/);
});

test('package scripts expose explicit release bump command', () => {
  assert.equal(packageJson.scripts.build, 'node build.mjs');
  assert.equal(packageJson.scripts['build:release'], 'node build.mjs --bump-version');
});
