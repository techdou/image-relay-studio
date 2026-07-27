import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  isTerminalStatus,
} from '../src/server/tasks/state-machine';
import { MockImageProvider } from '../src/server/providers/images/mock-provider';

test('task state machine rejects terminal-state transitions', () => {
  assert.equal(canTransition('queued', 'running'), true);
  assert.equal(canTransition('succeeded', 'running'), false);
  assert.equal(isTerminalStatus('failed'), true);
});

test('mock provider honors four-image sequential requests', async () => {
  const provider = new MockImageProvider();
  const result = await provider.generate({
    prompt: 'test',
    model_id: 'mock',
    size: '2K',
    sequential_generation: 'auto',
    sequential_max_images: 4,
  });

  assert.equal(result.success, true);
  assert.equal(result.image_b64_list.length, 4);
});
