import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApiKeySchema,
  imageListQuerySchema,
  openAiImageGenerationSchema,
} from '../src/server/validation/schemas';

test('generation input normalizes defaults and rejects fractional counts', () => {
  const parsed = openAiImageGenerationSchema.parse({ prompt: 'a cat' });
  assert.equal(parsed.model, 'image-pro');
  assert.equal(parsed.n, 1);
  assert.equal(parsed.response_format, 'url');

  assert.equal(
    openAiImageGenerationSchema.safeParse({ prompt: 'a cat', n: 1.5 }).success,
    false
  );
});

test('image pagination is bounded', () => {
  assert.deepEqual(imageListQuerySchema.parse({}), {
    page: 1,
    page_size: 24,
  });
  assert.equal(imageListQuerySchema.safeParse({ page_size: '101' }).success, false);
});

test('API key scopes are restricted to supported values', () => {
  assert.equal(
    createApiKeySchema.safeParse({
      name: 'client',
      scopes: ['images:read', 'admin:*'],
    }).success,
    false
  );
});
