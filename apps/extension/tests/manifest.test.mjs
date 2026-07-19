import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('src/manifest.json', 'utf8'));

test('manifest has expected core metadata', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'FlawFerret');
  assert.ok(typeof manifest.description === 'string' && manifest.description.length > 0);
});

test('manifest keeps required permissions', () => {
  const required = ['contextMenus', 'activeTab', 'scripting', 'storage', 'tabCapture', 'offscreen'];
  required.forEach((permission) => {
    assert.ok(manifest.permissions.includes(permission), `missing permission: ${permission}`);
  });
});

test('manifest keeps narrow Jira host permission and avoids global content scripts', () => {
  assert.ok(Array.isArray(manifest.host_permissions));
  assert.deepEqual(manifest.host_permissions, ['https://*.atlassian.net/*']);
  assert.equal(manifest.content_scripts, undefined);
});

test('manifest icon fields point to expected asset paths', () => {
  assert.deepEqual(manifest.icons, {
    '16': 'icons/icon16.png',
    '32': 'icons/icon32.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  });

  assert.deepEqual(manifest.action.default_icon, {
    '16': 'icons/icon16.png',
    '32': 'icons/icon32.png',
    '48': 'icons/icon48.png',
  });
});
