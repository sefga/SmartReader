import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordAudioStream } from '../src/lib/recording.ts';

test('Захват без звука освобождает все дорожки и сообщает, как выбрать источник', () => {
  let stopped = 0;
  const stream = {
    getAudioTracks: () => [],
    getTracks: () => [{ stop: () => { stopped++; } }],
  } as unknown as MediaStream;
  assert.throws(() => recordAudioStream(stream, () => undefined), /Поделиться аудио вкладки/u);
  assert.equal(stopped, 1);
});

test('Отсутствие кодека освобождает источник до начала записи', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  let stopped = 0;
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: { isTypeSupported: () => false } });
  const track = { readyState: 'live', stop: () => { stopped++; } };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  try {
    assert.throws(() => recordAudioStream(stream, () => undefined), /WebM не поддерживается/u);
    assert.equal(stopped, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'MediaRecorder', original);
    else Reflect.deleteProperty(globalThis, 'MediaRecorder');
  }
});
