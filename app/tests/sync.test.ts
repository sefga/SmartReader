import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCues, findActiveWord, parseText, validateCues, formatTime } from '../src/lib/sync.ts';

test('Заголовки и абзацы образуют единый порядок слов',()=>{
  const {blocks,words}=parseText('# Начало\n\nТри простых слова.\n\n# Конец');
  assert.deepEqual(words,['Начало','Три','простых','слова.','Конец']);
  assert.equal(blocks[2].first,4);
});

test('Markdown-заголовок отделяется от следующего абзаца без пустой строки',()=>{
  for (const newline of ['\n','\r\n']) {
    const {blocks,words}=parseText(['# Начало','Текст статьи.','## Раздел','Ещё текст.'].join(newline));
    assert.deepEqual(blocks.map(block=>block.kind),['heading','paragraph','heading','paragraph']);
    assert.equal(blocks[0].text,'Начало');
    assert.equal(blocks[2].first,3);
    assert.deepEqual(words,['Начало','Текст','статьи.','Раздел','Ещё','текст.']);
  }
});

test('Соседние заголовки сохраняются как отдельные разделы',()=>{
  const {blocks}=parseText('# Первый\n## Второй\nАбзац\nпродолжается.');
  assert.deepEqual(blocks.map(block=>block.text),['Первый','Второй','Абзац продолжается.']);
});
test('Авторазметка полностью покрывает аудио без перекрытий',()=>{
  const cues=estimateCues(['Текст','и','голос.'],12);
  assert.equal(cues[0].start,0);assert.equal(cues[2].end,12);
  assert.equal(cues[0].end,cues[1].start);
  assert.equal(findActiveWord(cues,cues[1].start),1);
  assert.equal(findActiveWord(cues,12),-1);
  assert.deepEqual(estimateCues([],10),[]);
});
test('Точные метки учитывают тишину и проверяют текст и время',()=>{
  const valid=[{word:'Текст',start:1,end:2},{word:'голос',start:3,end:4}];
  assert.equal(validateCues(valid,['Текст','голос.'],5).length,2);
  assert.equal(findActiveWord(valid,.5),-1);assert.equal(findActiveWord(valid,2.5),-1);
  assert.throws(()=>validateCues([{word:'Текст',start:0,end:8}],['Текст'],5));
  assert.throws(()=>validateCues([{word:'Другое',start:0,end:1}],['Текст'],5));
  assert.throws(()=>validateCues([{word:'Текст',start:0,end:2},{word:'голос',start:1,end:3}],['Текст','голос'],5));
});
test('Время отображается без отрицательных значений',()=>{
  assert.equal(formatTime(125.7),'2:05');assert.equal(formatTime(-4),'0:00');assert.equal(formatTime(NaN),'0:00');
});

test('Метки не принимаются при повреждённой длительности аудио',()=>{
  for(const duration of [NaN,Infinity,0,-1]) {
    assert.throws(()=>validateCues([{word:'Текст',start:0,end:1}],['Текст'],duration),/Длительность аудио/u);
  }
});
