import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignRecognizedWords } from '../src/lib/alignment.ts';
import { findActiveWord, validateCues } from '../src/lib/sync.ts';

test('Автоматические метки сохраняют начало, длинную паузу и границы распознанных слов',()=>{
  const words=['Здравствуйте,','это','проверка','синхронизации.','Теперь','слова','подсвечиваются','вовремя.'];
  const heard=[
    {text:'здравствуйте',start:1.3,end:2.4},{text:'это',start:2.6,end:3},
    {text:'проверка',start:3,end:3.6},{text:'синхронизации',start:3.6,end:4.6},
    {text:'теперь',start:7.1,end:7.5},{text:'слова',start:7.5,end:8},
    {text:'подсвечиваются',start:8,end:9},{text:'во',start:9,end:9.2},{text:'время',start:9.2,end:9.7},
  ];
  const result=alignRecognizedWords(words,heard,10);
  assert.equal(result.matched,8);assert.equal(result.estimated,0);
  assert.equal(result.cues[0].start,1.3);assert.equal(result.cues[3].end,4.6);
  assert.equal(findActiveWord(result.cues,5.5),-1);
  assert.equal(result.cues[4].start,7.1);
  assert.equal(result.cues[7].start,9);assert.equal(result.cues[7].end,9.7);
  assert.deepEqual(validateCues(result.cues,words,10),result.cues);
});

test('Нераспознанное слово между соседними интервалами не нарушает их порядок',()=>{
  const words=['раз','два','три','четыре','пять'];
  const heard=[{text:'раз',start:0,end:1},{text:'два',start:1,end:2},{text:'четыре',start:2,end:3},{text:'пять',start:3,end:4}];
  const result=alignRecognizedWords(words,heard,4);
  assert.equal(result.matched,4);assert.equal(result.estimated,1);
  assert.deepEqual(validateCues(result.cues,words,4),result.cues);
  assert.ok(result.cues[2].end > result.cues[2].start);
  assert.equal(result.cues[3].start,2);
});

test('Несоответствующая озвучка не выдаётся за синхронизацию',()=>{
  assert.throws(()=>alignRecognizedWords(['один','два','три'],[{text:'совсем',start:1,end:2},{text:'другое',start:2,end:3}],5),/Совпало/u);
  assert.throws(()=>alignRecognizedWords(['текст'],[{text:'шум',start:0,end:0}],4),/не удалось распознать/u);
  assert.throws(()=>alignRecognizedWords(['текст'],[{text:'текст',start:0,end:1}],NaN),/длительность/u);
});

test('Пунктуация, регистр и буква ё не мешают сопоставлению',()=>{
  const words=['Ещё,','текст','—','вперёд!'];
  const heard=[{text:'еще',start:.5,end:1},{text:'ТЕКСТ',start:1,end:2},{text:'вперед',start:2,end:3}];
  const result=alignRecognizedWords(words,heard,4);
  assert.equal(result.matched,3);assert.equal(result.total,3);assert.equal(result.estimated,1);
  assert.deepEqual(validateCues(result.cues,words,4),result.cues);
});

test('Раздельное написание в тексте сопоставляется со слитным произношением',()=>{
  const words=['слова','во','время','паузы'];
  const heard=[{text:'слова',start:1,end:2},{text:'вовремя',start:2,end:3},{text:'паузы',start:3,end:4}];
  const result=alignRecognizedWords(words,heard,5);
  assert.equal(result.matched,4);assert.equal(result.estimated,2);
  assert.equal(result.cues[1].start,2);assert.equal(result.cues[2].end,3);
  assert.deepEqual(validateCues(result.cues,words,5),result.cues);
});
