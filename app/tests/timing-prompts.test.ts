import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimingPrompts, parseTimingJson } from '../src/lib/timing-prompts.ts';
import type { ReadingDocument } from '../src/lib/sync.ts';

const document: ReadingDocument = { title: 'Тест', text: '# Начало\n\nПривет мир.', duration: 6, position: 0, cues: [] };
const cues = [{ word: 'Начало', start: 0, end: 1 }, { word: 'Привет', start: 2, end: 3 }, { word: 'мир.', start: 4, end: 5 }];

test('Задание содержит точные слова с заголовком, длительность и правило не выдумывать время', () => {
  const prompt = createTimingPrompts(document);
  assert.match(prompt.system, /не выдумывай/iu);
  assert.match(prompt.system, /аудио/iu);
  const data = JSON.parse(prompt.user.slice(prompt.user.indexOf('{')));
  assert.deepEqual(data.words, ['Начало', 'Привет', 'мир.']);
  assert.equal(data.durationSeconds, 6);
});

test('JSON можно вставить массивом, объектом или целым блоком кода из чата', () => {
  for (const value of [JSON.stringify(cues), JSON.stringify({ words: cues }), `\`\`\`json\n${JSON.stringify({ words: cues })}\n\`\`\``]) {
    assert.deepEqual(parseTimingJson(value, ['Начало', 'Привет', 'мир.'], 6), cues);
  }
});

test('Неполный ответ, ошибочный порядок и выдуманные границы не применяются', () => {
  assert.throws(() => parseTimingJson('{"words":', ['Начало'], 6), /JSON/u);
  assert.throws(() => parseTimingJson('{"error":"Нет аудио"}', ['Начало'], 6), /аудио|разметк/u);
  assert.throws(() => parseTimingJson(JSON.stringify(cues), ['другие', 'слова', 'тут'], 6), /не совпадает/u);
  assert.throws(() => parseTimingJson(JSON.stringify([{ word: 'Начало', start: 0, end: 20 }]), ['Начало'], 6), /время/u);
});
