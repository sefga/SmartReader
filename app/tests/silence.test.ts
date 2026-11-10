import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlobSource, Input, MP3 } from 'mediabunny';
import { detectSilences, remapCuesAfterSilence, validateSilences } from '../src/lib/silence.ts';
import { removeSilenceToMp3 } from '../src/lib/mp3.ts';

function sampleAudio(): File {
  const rate = 16_000, duration = 6, frames = rate * duration;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for (let index=0;index<frames;index++) {
    const time=index/rate;
    const sound=(time>=0.5&&time<1.5)||(time>=4&&time<5);
    bytes.writeInt16LE(sound ? Math.round(Math.sin(index*440*Math.PI*2/rate)*9000) : 0,44+index*2);
  }
  return new File([bytes],'проверка.wav',{type:'audio/wav'});
}

test('Длинная тишина находится по аудио, короткие паузы сохраняются',async()=>{
  const ranges=await detectSilences(sampleAudio(),6);
  assert.equal(ranges.length,1);
  assert.ok(Math.abs(ranges[0].start-1.62)<0.08);
  assert.ok(Math.abs(ranges[0].end-3.88)<0.08);
  const mapped=remapCuesAfterSilence([{word:'первое',start:.5,end:1.5},{word:'второе',start:4,end:5}],ranges,6);
  assert.equal(mapped.cues[0].start,.5);
  assert.ok(Math.abs(mapped.cues[1].start-(4-(ranges[0].end-ranges[0].start)))<0.001);
  assert.ok(mapped.duration<4);
});

test('Удаление пауз создаёт MP3 с сокращённой длительностью',async()=>{
  const source=sampleAudio();
  const ranges=await detectSilences(source,6);
  const file=await removeSilenceToMp3(source,source.name,ranges,6);
  assert.equal(file.type,'audio/mpeg');assert.ok(file.size>0);
  const input=new Input({source:new BlobSource(file),formats:[MP3]});
  try {assert.ok(Math.abs(await input.computeDuration()-(6-(ranges[0].end-ranges[0].start)))<0.12);}
  finally {input.dispose();}
});

test('Нельзя удалить целое слово или использовать повреждённые интервалы',()=>{
  assert.throws(()=>remapCuesAfterSilence([{word:'слово',start:2,end:3}],[{start:1,end:4}],6),/синхронизацию/u);
  assert.throws(()=>validateSilences([{start:2,end:3},{start:2.5,end:4}],6),/паузы|пауз/u);
});
