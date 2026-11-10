import { diffArrays } from 'diff';
import { validateCues, type WordCue } from './sync.ts';

export interface RecognizedWord { text: string; start: number; end: number }
export interface AlignmentResult { cues: WordCue[]; matched: number; total: number; estimated: number }

export function normalize(word: string): string {
  return word.normalize('NFKC').toLocaleLowerCase().replace(/ё/gu, 'е').replace(/[^\p{L}\p{N}]/gu, '');
}

export function alignRecognizedWords(words: string[], recognized: RecognizedWord[], duration: number): AlignmentResult {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Не удалось определить длительность записи.');
  const reference = words.map((word, index) => ({ word: normalize(word), index })).filter(item => item.word);
  const heard: { word: string; start: number; end: number }[] = [];
  for (const item of recognized) {
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start || item.start >= duration) continue;
    const parts = item.text.trim().split(/\s+/u).map(normalize).filter(Boolean);
    const end = Math.min(item.end, duration);
    for (let index = 0; index < parts.length; index++) {
      const start = Math.max(item.start + (end - item.start) * index / parts.length, heard.at(-1)?.end ?? 0);
      const partEnd = item.start + (end - item.start) * (index + 1) / parts.length;
      if (partEnd > start) heard.push({ word: parts[index], start, end: partEnd });
    }
  }
  if (!reference.length || !heard.length) throw new Error('В записи не удалось распознать слова. Проверьте звук и повторите попытку.');
  const changes = diffArrays(reference.map(item => item.word), heard.map(item => item.word), { maxEditLength: 2000, timeout: 3000 });
  if (!changes) throw new Error('Текст и запись слишком сильно различаются. Проверьте, что загружена нужная озвучка.');

  const result: (WordCue | undefined)[] = Array(words.length);
  let refIndex = 0, heardIndex = 0, matched = 0, matchedHeard = 0, estimated = 0;
  for (let changeIndex = 0; changeIndex < changes.length; changeIndex++) {
    const change = changes[changeIndex];
    const next = changes[changeIndex + 1];
    if (next && ((change.removed && next.added) || (change.added && next.removed))) {
      const removed = change.removed ? change : next;
      const added = change.added ? change : next;
      const refCount = removed.value.length, heardCount = added.value.length;
      if (refCount <= 4 && heardCount <= 4 && (refCount === 1 || heardCount === 1) && removed.value.join('') === added.value.join('')) {
        const start = heard[heardIndex].start, end = heard[heardIndex + heardCount - 1].end;
        const lengths = reference.slice(refIndex, refIndex + refCount).map(item => item.word.length);
        const totalLength = lengths.reduce((sum, length) => sum + length, 0);
        let offset = 0;
        for (let index = 0; index < refCount; index++) {
          const original = reference[refIndex + index];
          const wordStart = start + (end - start) * offset / totalLength;
          offset += lengths[index];
          result[original.index] = { word: words[original.index], start: wordStart, end: index === refCount - 1 ? end : start + (end - start) * offset / totalLength };
        }
        if (refCount > 1) estimated += refCount;
        refIndex += refCount; heardIndex += heardCount; matched += refCount; matchedHeard += heardCount; changeIndex++;
        continue;
      }
    }
    const count = change.value.length;
    if (change.added) heardIndex += count;
    else if (change.removed) refIndex += count;
    else {
      for (let index = 0; index < count; index++) {
        const original = reference[refIndex++];
        const spoken = heard[heardIndex++];
        result[original.index] = { word: words[original.index], start: spoken.start, end: spoken.end };
        matched++;matchedHeard++;
      }
    }
  }
  const coverage = matched / reference.length;
  if (coverage < 0.8 || matchedHeard / heard.length < 0.8) {
    throw new Error(`Совпало ${Math.round(coverage * 100)}% слов текста и ${Math.round(matchedHeard / heard.length * 100)}% распознанной речи. Проверьте текст, озвучку и прочитанные заголовки.`);
  }

  for (let first = 0; first < result.length;) {
    if (result[first]) { first++; continue; }
    let after = first + 1;
    while (after < result.length && !result[after]) after++;
    const count = after - first;
    const previous = first > 0 ? result[first - 1] : undefined;
    const next = after < result.length ? result[after] : undefined;
    let left = previous?.end ?? (next && heard[0].start < next.start ? heard[0].start : 0);
    const lastHeardEnd = heard.at(-1)?.end ?? 0;
    let right = next?.start ?? (lastHeardEnd > left ? lastHeardEnd : duration);
    const required = count * 0.005;
    if (right - left < required) {
      let missing = required - (right - left);
      if (previous) { const take = Math.min(missing, (previous.end - previous.start) / 4); previous.end -= take; left -= take; missing -= take; }
      if (next && missing > 0) { const take = Math.min(missing, (next.end - next.start) / 4); next.start += take; right += take; missing -= take; }
      if (missing > 1e-8) throw new Error('Для некоторых слов не удалось определить время. Попробуйте точные метки JSON.');
    }
    const weights = words.slice(first, after).map(word => Math.max(1, normalize(word).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let offset = 0;
    for (let index = 0; index < count; index++) {
      const start = left + (right - left) * offset / total;
      offset += weights[index];
      result[first + index] = { word: words[first + index], start, end: index === count - 1 ? right : left + (right - left) * offset / total };
    }
    estimated += count;
    first = after;
  }
  return { cues: validateCues(result, words, duration), matched, total: reference.length, estimated };
}
