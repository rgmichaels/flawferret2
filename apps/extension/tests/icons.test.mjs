import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function readPngSize(path) {
  const buf = fs.readFileSync(path);
  const pngSignature = '89504e470d0a1a0a';
  assert.equal(buf.subarray(0, 8).toString('hex'), pngSignature, `${path} is not a PNG file`);

  // PNG IHDR width/height are 4-byte big-endian values at bytes 16..23.
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

test('required icon assets exist and have expected dimensions', () => {
  const expected = [
    ['src/icons/icon16.png', 16],
    ['src/icons/icon32.png', 32],
    ['src/icons/icon48.png', 48],
    ['src/icons/icon128.png', 128],
  ];

  expected.forEach(([path, size]) => {
    assert.ok(fs.existsSync(path), `missing icon file: ${path}`);
    const { width, height } = readPngSize(path);
    assert.equal(width, size, `${path} width mismatch`);
    assert.equal(height, size, `${path} height mismatch`);
  });
});
