import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBoundaryWords } from '../src/lib/boundary-sync.ts';

test('Перекрывающийся фрагмент уточняет начало слова после границы модели',()=>{
  const words=[
    {text:'паузы.',start:27.64,end:28.46},
    {text:'Здравствуйте,',start:30.70,end:31.20},
    {text:'это',start:31.40,end:31.80},
  ];
  const heard=[{text:'здравствуйте',start:30.10,end:31.25},{text:'это',start:31.42,end:31.82}];
  const result=mergeBoundaryWords(words,heard,30,43);
  assert.equal(result.words[1].start,30.10);
  assert.equal(result.words[1].end,31.25);
  assert.deepEqual(result.words[0],words[0]);
  assert.equal(words[1].start,30.70);
});

test('Уточнение не добавляет посторонние слова и не создаёт перекрытия',()=>{
  const words=[{text:'один',start:29,end:30},{text:'два',start:30,end:31}];
  const heard=[{text:'два',start:29.7,end:30.8},{text:'постороннее',start:30.8,end:31.4}];
  const result=mergeBoundaryWords(words,heard,30,32);
  assert.equal(result.matched,1);
  assert.equal(result.words[1].start,30);
  assert.equal(result.words[1].end,30.8);
  assert.equal(result.words.length,2);
});
