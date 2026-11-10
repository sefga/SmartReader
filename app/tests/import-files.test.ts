import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMaterialFiles } from '../src/lib/import-files.ts';

test('Markdown и аудио принимаются вместе независимо от порядка и наличия MIME', () => {
  const text = new File(['# Статья'], 'Статья.MD');
  const audio = new File(['звук'], 'запись.mp3');
  assert.deepEqual(parseMaterialFiles([audio, text]), { text, audio });
  assert.equal(parseMaterialFiles([new File(['текст'], 'статья.markdown')]).text?.name, 'статья.markdown');
  assert.equal(parseMaterialFiles([new File(['звук'], 'запись', { type: 'audio/webm' })]).audio?.type, 'audio/webm');
});

test('Импорт отклоняет посторонние, пустые и неоднозначные наборы файлов', () => {
  assert.throws(() => parseMaterialFiles([new File(['код'], 'страница.html')]), /TXT|Markdown/u);
  assert.throws(() => parseMaterialFiles([new File([], 'пустой.wav')]), /пуст/u);
  assert.throws(() => parseMaterialFiles([new File(['а'], 'а.md'), new File(['б'], 'б.txt')]), /один текстовый/u);
  assert.throws(() => parseMaterialFiles([new File(['а'], 'а.mp3'), new File(['б'], 'б.wav')]), /один аудиофайл/u);
});

test('Ограничения размера одинаковы для выбора файла и перетаскивания', () => {
  assert.throws(() => parseMaterialFiles([new File([new Uint8Array(2_000_001)], 'статья.txt')]), /2 МБ/u);
  const oversized = new File(['звук'], 'запись.ogg');
  Object.defineProperty(oversized, 'size', { value: 150_000_001 });
  assert.throws(() => parseMaterialFiles([oversized]), /150 МБ/u);
});
