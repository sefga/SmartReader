import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { recordAudioStream } from '../src/lib/recording.ts';

const originalRecorder = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
const originalStream = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
let now = 0;

class FakeRecorder {
  static current: FakeRecorder;
  static isTypeSupported(): boolean { return true; }
  state: RecordingState = 'inactive';
  timeslice = 0;
  requests = 0;
  final = 'последний';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeRecorder.current = this; }
  start(timeslice: number): void { this.state = 'recording'; this.timeslice = timeslice; }
  emit(value: string): void { this.ondataavailable?.({ data: new Blob([value], { type: 'audio/webm' }) } as BlobEvent); }
  requestData(): void { this.requests++; this.emit('промежуточный'); }
  stop(): void {
    this.state = 'inactive';
    queueMicrotask(() => { this.emit(this.final); this.onstop?.(); });
  }
}

function setup(): MediaStream {
  now = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder });
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: class {} });
  const track = { readyState: 'live', stop: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
  return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

afterEach(() => {
  for (const [name, descriptor] of [['MediaRecorder', originalRecorder], ['MediaStream', originalStream]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
  if (originalNow) Object.defineProperty(performance, 'now', originalNow); else Reflect.deleteProperty(performance, 'now');
});

test('flush выдаёт промежуточный chunk без остановки записи', async () => {
  const saved: { text: string; elapsed: number }[] = [];
  const recording = recordAudioStream(setup(), () => {}, async (chunk, elapsed) => { saved.push({ text: await chunk.text(), elapsed }); });
  assert.equal(FakeRecorder.current.timeslice, 1000);
  now = 1200;
  recording.flush();
  assert.equal(FakeRecorder.current.state, 'recording');
  now = 2400;
  recording.stop();
  await recording.result;
  assert.deepEqual(saved, [{ text: 'промежуточный', elapsed: 1200 }, { text: 'последний', elapsed: 2400 }]);
});

test('Завершение ждёт последовательного сохранения, включая последний dataavailable', async () => {
  let allowFirst: () => void = () => {};
  const firstPending = new Promise<void>(resolve => { allowFirst = resolve; });
  const saved: string[] = [];
  const recording = recordAudioStream(setup(), () => {}, async chunk => {
    const text = await chunk.text();
    if (text === 'первый') await firstPending;
    saved.push(text);
  });
  now = 1000; FakeRecorder.current.emit('первый');
  now = 2000; recording.stop();
  let finished = false;
  void recording.result.then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  assert.deepEqual(saved, []);
  allowFirst();
  const result = await recording.result;
  assert.deepEqual(saved, ['первый', 'последний']);
  assert.equal(await result.file.text(), 'первыйпоследний');
});

test('Ошибка сохранения chunks не прерывает захват и оставляет файл для ручного скачивания', async () => {
  const recording = recordAudioStream(setup(), () => {}, async () => { throw new Error('QuotaExceededError'); });
  now = 1000; FakeRecorder.current.emit('первый');
  now = 2000; recording.stop();
  const result = await recording.result;
  assert.equal(await result.file.text(), 'первыйпоследний');
  assert.match(result.warning || '', /сохран|скач/iu);
});

test('Ошибка MediaRecorder сохраняет доступные данные как частичный файл', async () => {
  const recording = recordAudioStream(setup(), () => {});
  now = 1000; FakeRecorder.current.emit('сохранённый');
  now = 2000; FakeRecorder.current.onerror?.();
  const result = await recording.result;
  assert.equal(result.partial, true);
  assert.equal(await result.file.text(), 'сохранённыйпоследний');
  assert.match(result.warning || '', /прерва|частич/iu);
});

test('Авария короткой записи не скрывает уже полученные данные', async () => {
  const recording = recordAudioStream(setup(), () => {});
  now = 100; FakeRecorder.current.emit('начало');
  now = 150; FakeRecorder.current.onerror?.();
  const result = await recording.result;
  assert.equal(result.partial, true);
  assert.ok(result.file.size > 0);
});

test('Явная отмена ждёт callback последнего chunk перед отклонением результата', async () => {
  const saved: string[] = [];
  const recording = recordAudioStream(setup(), () => {}, async chunk => { saved.push(await chunk.text()); });
  now = 1000; recording.cancel();
  await assert.rejects(recording.result, { name: 'AbortError' });
  assert.deepEqual(saved, ['последний']);
});
