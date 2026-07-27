import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectImageMimeType,
  readImageDimensions,
} from '../src/server/images/image-utils';

test('reads PNG dimensions from the IHDR header', () => {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);

  assert.equal(detectImageMimeType(png), 'image/png');
  assert.deepEqual(readImageDimensions(png), { width: 640, height: 480 });
});

test('reads extended WebP dimensions', () => {
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'ascii');
  webp.writeUInt32LE(22, 4);
  webp.write('WEBP', 8, 'ascii');
  webp.write('VP8X', 12, 'ascii');
  const widthMinusOne = 1919;
  const heightMinusOne = 1079;
  webp[24] = widthMinusOne & 0xff;
  webp[25] = (widthMinusOne >> 8) & 0xff;
  webp[26] = (widthMinusOne >> 16) & 0xff;
  webp[27] = heightMinusOne & 0xff;
  webp[28] = (heightMinusOne >> 8) & 0xff;
  webp[29] = (heightMinusOne >> 16) & 0xff;

  assert.equal(detectImageMimeType(webp), 'image/webp');
  assert.deepEqual(readImageDimensions(webp), { width: 1920, height: 1080 });
});

test('does not trust a declared MIME type when magic bytes are invalid', () => {
  const invalid = Buffer.from('not an image');
  assert.equal(detectImageMimeType(invalid), null);
  assert.equal(readImageDimensions(invalid, 'image/webp'), null);
});
