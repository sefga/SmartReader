import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobSource, Input, MP3 } from 'mediabunny';

function toneWav(): File {
  const count = 22_050;
  const bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(44_100, 24); bytes.writeUInt32LE(88_200, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 440 * Math.PI * 2 / 44_100) * 10_000), 44 + index * 2);
  return new File([bytes], 'голос.wav', { type: 'audio/wav' });
}

test('Экспорт создаёт настоящий MP3, а не переименовывает исходный контейнер', async () => {
  const modulePath = '../src/lib/mp3.ts';
  const converter = await import(modulePath).catch(() => undefined);
  assert.equal(typeof converter?.convertToMp3, 'function', 'В приложении отсутствует конвертация MP3');
  const source = toneWav();
  const result: File = await converter.convertToMp3(source, source.name);
  assert.equal(result.name, 'голос.mp3');
  assert.equal(result.type, 'audio/mpeg');
  assert.ok(result.size > 0);
  assert.notDeepEqual(new Uint8Array(await result.slice(0, 4).arrayBuffer()), new Uint8Array(await source.slice(0, 4).arrayBuffer()));
  const input = new Input({ source: new BlobSource(result), formats: [MP3] });
  try {
    const track = await input.getPrimaryAudioTrack();
    assert.ok(track, 'В MP3 отсутствует звуковая дорожка');
    assert.ok(Math.abs(await input.computeDuration() - 0.5) < 0.1, 'Длительность звука изменилась');
  } finally { input.dispose(); }
});

test('Отменённая конвертация не создаёт файл и не меняет исходник', async () => {
  const modulePath = '../src/lib/mp3.ts';
  const converter = await import(modulePath).catch(() => undefined);
  assert.equal(typeof converter?.convertToMp3, 'function', 'В приложении отсутствует конвертация MP3');
  const source = toneWav();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(converter.convertToMp3(source, source.name, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(source.type, 'audio/wav');
});
