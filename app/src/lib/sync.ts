export interface WordCue { word: string; start: number; end: number }
export interface TextBlock { kind: 'heading' | 'paragraph'; text: string; first: number; count: number }
export interface ReadingDocument { title: string; text: string; cues: WordCue[]; duration: number; position: number; audioName?: string; alignment?: { matched: number; total: number; estimated: number; boundaryWarning?: boolean; source?: 'local' | 'openai' | 'gemini' } }

export const DEMO_TEXT = `# Читать в своём ритме

Иногда хочется замедлиться. Открыть статью, надеть наушники и просто следовать за голосом. Не искать нужную строку, не пытаться удержать в памяти каждую мысль. Только текст, звук и немного внимания.

Здесь слова связаны с аудио. Нажмите на любое слово, чтобы продолжить с этого места. Меняйте скорость, делайте паузы и возвращайтесь к важным мыслям.

# Один текст — два способа

Чтение и слушание хорошо дополняют друг друга. Голос помогает почувствовать интонацию, а текст позволяет заметить детали. Вместе они создают спокойное пространство для понимания.

Вы можете загрузить собственную статью и её озвучку. Содержание останется в этом браузере. При следующем открытии читалка вспомнит, где вы остановились.

# Продолжайте с нужного места

Оглавление всегда под рукой. Перейдите к разделу, вернитесь на пятнадцать секунд назад или поставьте закладку. Прогресс показывает, какая часть статьи уже прозвучала.

Без точных меток времени подсветка распределяется приблизительно, по длине слов. Для точного совпадения загрузите файл с метками каждого слова. Ваша история, ваш голос, ваш ритм.`;

export function parseText(text: string): { blocks: TextBlock[]; words: string[] } {
  const words: string[] = [];
  const normalized = text.replace(/\r\n?/gu, '\n').replace(/^(#{1,6}[\t ]+[^\n]*)\n/gmu, '$1\n\n');
  const blocks = normalized.trim().split(/\n\s*\n|\n(?=#{1,6}[\t ])/u).filter(Boolean).map(part => {
    const heading = /^#{1,6}\s/u.test(part.trim());
    const clean = part.trim().replace(/^#{1,6}\s+/u, '').replace(/\s+/gu, ' ');
    const tokens = clean.split(/\s+/u).filter(Boolean);
    const block: TextBlock = { kind: heading ? 'heading' : 'paragraph', text: clean, first: words.length, count: tokens.length };
    words.push(...tokens);
    return block;
  });
  return { blocks, words };
}

export function estimateCues(words: string[], duration: number): WordCue[] {
  if (!Number.isFinite(duration) || duration <= 0 || !words.length) return [];
  const weights = words.map(word => Math.max(2, word.replace(/[^\p{L}\p{N}]/gu, '').length) + (/[.!?…]$/u.test(word) ? 4 : /[,;:]$/u.test(word) ? 2 : 0));
  const total = weights.reduce((a,b)=>a+b,0);
  let elapsed = 0;
  return words.map((word,index)=> {
    const start = elapsed / total * duration;
    elapsed += weights[index];
    return { word, start, end: elapsed / total * duration };
  });
}

export function findActiveWord(cues: WordCue[], time: number): number {
  if (!cues.length || time < cues[0].start) return -1;
  let low = 0, high = cues.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (cues[middle].start <= time) low = middle; else high = middle - 1;
  }
  return time < cues[low].end ? low : -1;
}

export function validateCues(value: unknown, words: string[], duration: number): WordCue[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Длительность аудио должна быть положительным конечным числом.');
  const list = Array.isArray(value) ? value : typeof value === 'object' && value !== null && 'words' in value ? (value as {words:unknown}).words : null;
  if (!Array.isArray(list) || list.length !== words.length) throw new Error(`Метки должны содержать все слова текста: ${words.length}.`);
  let previousEnd = 0;
  const normalize = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return list.map((item: unknown,index:number)=> {
    if (typeof item !== 'object' || item === null) throw new Error(`Некорректная метка №${index+1}.`);
    const {word,start,end} = item as Partial<WordCue>;
    if (typeof word !== 'string' || normalize(word) !== normalize(words[index])) throw new Error(`Слово №${index+1} не совпадает с текстом: «${words[index]}».`);
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end <= start || end > duration + 0.1) throw new Error(`Проверьте время слова №${index+1}: метки должны идти по порядку и помещаться в аудио.`);
    previousEnd = end;
    return { word: words[index], start, end };
  });
}

export function formatTime(seconds: number): string {
  const time = Number.isFinite(seconds) ? Math.max(0,Math.floor(seconds)) : 0;
  return `${Math.floor(time/60)}:${String(time%60).padStart(2,'0')}`;
}
