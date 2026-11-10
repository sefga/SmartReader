import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { createEmbedCode, createPublication, createStandalonePublication, publicationAudioName } from '../src/lib/publication.ts';
import { estimateCues, parseText, type ReadingDocument } from '../src/lib/sync.ts';

function example(text = '# Начало\n\nМоя статья.'): ReadingDocument {
  return { title: 'Моя статья', text, cues: estimateCues(parseText(text).words, 12), duration: 12, position: 0, audioName: 'озвучка.WAV' };
}

test('Экспорт включает текст, метки и переносимую ссылку на скачанное аудио', () => {
  const html = createPublication(example(), true);
  assert.match(html, /src="\.\/article-audio\.wav"/u);
  assert.match(html, /Метки из JSON/u);
  assert.match(html, /data-word="2">статья\./u);
  assert.match(html, /href="#section-0"/u);
  assert.equal((html.match(/<script>/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /blob:|localhost|_next|indexedDB/u);
  assert.match(createPublication(example(), false), /Приблизительная подсветка/u);
  const automatic = createPublication({ ...example(), alignment: { matched: 3, total: 3, estimated: 0 } }, false);
  assert.match(automatic, /Автоматическая синхронизация: возможны неточности/u);
  assert.doesNotMatch(automatic, /Точные метки слов/u);
  assert.throws(() => createPublication({ ...example(), cues: [] }, true));
});

test('Автономный HTML содержит полное аудио и интервалы пауз без соседних файлов',async()=>{
  const bytes=Uint8Array.from({length:200_003},(_,index)=>index%251);
  const page=await createStandalonePublication(example(),false,new Blob([bytes],{type:'audio/mpeg'}),{silences:[{start:3,end:5}]});
  const html=await page.text();
  const audio=html.match(/src="data:audio\/mpeg;base64,([A-Za-z0-9+/=]+)"/u)?.[1];
  assert.ok(audio);
  assert.deepEqual(new Uint8Array(Buffer.from(audio,'base64')),bytes);
  assert.match(html,/Пропускать паузы/u);
  assert.match(html,/"silences":\[\{"start":3,"end":5\}\]/u);
  assert.doesNotMatch(html,/src="\.\/article-audio/u);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(createStandalonePublication(example(),false,new Blob([bytes],{type:'audio/mpeg'}),{signal:aborted.signal}),{name:'AbortError'});
});

/** Запускает именно inline JS экспортированного HTML с минимальными DOM/audio границами. */
function portablePlayer(html: string, saved = new Map<string, string>(), unavailableStorage = false, width = 1280) {
  type Handler = (event: Record<string, unknown>) => void | Promise<void>;
  class Element {
    listeners = new Map<string, Handler[]>();
    attributes = new Map<string, string>();
    classes = new Set<string>();
    dataset: Record<string, string> = {};
    style = { fontSize: '', setProperty: (key: string, value: string) => { this.attributes.set(key, value); } };
    classList = { toggle: (name: string, force?: boolean) => { const next = force ?? !this.classes.has(name); if (next) this.classes.add(name); else this.classes.delete(name); return next; } };
    hidden = false; disabled = false; open = false; value = ''; textContent = ''; offsetHeight = 1200;
    paused = true; ended = false; currentTime = 0; duration = 12; playbackRate = 1;
    src = 'data:audio/mpeg;base64,AQID'; href = ''; download = ''; scrolls = 0;
    addEventListener(name: string, handler: Handler): void { this.listeners.set(name, [...this.listeners.get(name) || [], handler]); }
    async fire(name: string, event: Record<string, unknown> = {}): Promise<void> { for (const handler of this.listeners.get(name) || []) await handler({ target: this, ...event }); }
    setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
    getAttribute(key: string): string | null { return this.attributes.get(key) ?? null; }
    removeAttribute(key: string): void { this.attributes.delete(key); }
    closest(): Element { return this; }
    focus(): void {}
    showModal(): void { this.open = true; }
    close(): void { this.open = false; }
    getBoundingClientRect() { return { top: 300, bottom: 1500, height: 1200 }; }
    scrollIntoView(): void { this.scrolls++; }
    async play(): Promise<void> { this.paused = false; await this.fire('play'); }
    pause(): void { this.paused = true; void this.fire('pause'); }
  }
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<[a-z][\w-]*\b[^>]*\bid="([^"]+)"[^>]*>/giu)) {
    const element = new Element();
    element.hidden = /\bhidden(?:\s|>)/u.test(match[0]);
    element.value = /\bvalue="([^"]*)"/u.exec(match[0])?.[1] || '';
    elements.set(match[1], element);
  }
  const words = [...html.matchAll(/data-word="(\d+)"/gu)].map(match => { const node = new Element(); node.dataset.word = match[1]; return node; });
  const headings = [...html.matchAll(/data-section="(\d+)"/gu)].map(match => { const node = new Element(); node.dataset.section = match[1]; return node; });
  const links = [...html.matchAll(/data-section-link="(-?\d+)"/gu)].map(match => { const node = new Element(); node.dataset.sectionLink = match[1]; return node; });
  const page = new Element();
  const body = new Element();
  const sandbox = {
    document: { getElementById: (id: string) => elements.get(id) || null, body, visibilityState: 'visible',
      querySelectorAll: (selector: string) => selector === '[data-word]' ? words : selector === '[data-section]' ? headings : selector === '[data-section-link]' ? links : [],
      addEventListener: page.addEventListener.bind(page),
    },
    window: page, innerHeight: 720, scrollY: 0,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, matchMedia: () => ({ matches: true }),
    localStorage: {
      getItem: (key: string) => { if (unavailableStorage) throw new Error('Доступ запрещён'); return saved.get(key) || null; },
      setItem: (key: string, value: string) => { if (unavailableStorage) throw new Error('Нет места'); saved.set(key, value); },
    },
  };
  Object.assign(page, { innerHeight: 720, innerWidth: width, scrollY: 0, matchMedia: sandbox.matchMedia, scrollTo: () => {} });
  const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
  assert.ok(script);
  runInNewContext(script, sandbox);
  const get = (id: string): Element => { const element = elements.get(id); assert.ok(element, `Отсутствует элемент ${id}`); return element; };
  return { get, words, page, body, saved };
}

test('Автономный плеер сворачивается и раскрывается без остановки; кнопки, шкала и скорость управляют тем же аудио', async () => {
  const html = createPublication(example(), true);
  assert.match(html, /class="reader-topbar"/u);
  assert.match(html, /class="audio-player"/u);
  assert.doesNotMatch(html, /<audio[^>]*\bcontrols\b/u);
  assert.match(html, /value="1\.75"/u);
  const player = portablePlayer(html);
  const audio = player.get('audio');
  await audio.fire('loadedmetadata');
  assert.equal(player.get('audio-player-controls').hidden, true);
  assert.equal(player.get('mini-player').hidden, true);
  assert.equal(audio.paused, true);
  await player.get('listen').fire('click');
  assert.equal(player.get('audio-player-controls').hidden, false);
  assert.equal(audio.paused, false);
  await player.get('listen').fire('click');
  assert.equal(audio.paused, false);
  await player.get('collapse-player').fire('click');
  assert.equal(player.get('audio-player-controls').hidden, true);
  assert.equal(player.get('mini-player').hidden, false);
  assert.equal(audio.paused, false);
  await player.get('show-player').fire('click');
  assert.equal(player.get('audio-player-controls').hidden, false);
  assert.equal(audio.paused, false);
  player.get('speed').value = '1.75'; await player.get('speed').fire('change');
  assert.equal(audio.playbackRate, 1.75);
  assert.equal(audio.paused, true, 'Как в Reader, смена скорости сначала ставит воспроизведение на паузу');
  player.get('timeline').value = '8'; await player.get('timeline').fire('input');
  assert.equal(audio.currentTime, 8);
  await player.get('back').fire('click'); assert.equal(audio.currentTime, 0);
  await player.get('forward').fire('click'); assert.equal(audio.currentTime, 12);
  await player.get('play').fire('click');
  await player.get('collapse-player').fire('click');
  await player.get('mini-play').fire('click'); assert.equal(audio.paused, true);
  const afterReload = portablePlayer(html, player.saved);
  await afterReload.get('audio').fire('loadedmetadata');
  await afterReload.page.fire('keydown', { code: 'Space', target: { closest: () => null }, preventDefault: () => {} });
  assert.equal(afterReload.get('audio').paused, true, 'В режиме чистого чтения клавиша не должна запускать скрытое аудио');
});

test('Закладки, размер текста и позиция восстанавливаются отдельно для статьи; чтение работает без localStorage', async () => {
  const saved = new Map<string, string>();
  const html = createPublication(example(), true);
  const first = portablePlayer(html, saved);
  await first.get('audio').fire('loadedmetadata');
  first.get('timeline').value = '7'; await first.get('timeline').fire('input');
  await first.get('bookmark').fire('click');
  first.get('font-size').value = '28'; await first.get('font-size').fire('input');
  first.get('timeline').value = '10'; await first.get('timeline').fire('input');
  await first.get('return-bookmark').fire('click');
  assert.equal(first.get('audio').currentTime, 7);
  const restored = portablePlayer(html, saved);
  await restored.get('audio').fire('loadedmetadata');
  assert.equal(restored.get('audio').currentTime, 7);
  assert.equal(restored.get('article').style.fontSize, '28px');
  const another = portablePlayer(createPublication({ ...example(), title: 'Другая статья' }, true), saved);
  await another.get('audio').fire('loadedmetadata');
  assert.equal(another.get('audio').currentTime, 0);
  const mobile = portablePlayer(html, new Map(), false, 390);
  assert.equal(mobile.get('article').style.fontSize, '17px');
  const withoutStorage = portablePlayer(html, new Map(), true);
  await withoutStorage.get('listen').fire('click');
  await withoutStorage.get('bookmark').fire('click');
  assert.equal(withoutStorage.get('audio').paused, false);
  assert.match(withoutStorage.get('message').textContent, /закрытия|страниц/iu);
});

test('Переход по слову, пропуск пауз и клавиши работают; ввод текста и кнопки не перехватываются', async () => {
  const doc = example('Один два три');
  doc.cues = [{ word: 'Один', start: 0, end: 2 }, { word: 'два', start: 6, end: 7 }, { word: 'три', start: 8, end: 10 }];
  const player = portablePlayer(createPublication(doc, true, { silences: [{ start: 2, end: 6 }] }));
  const audio = player.get('audio');
  await player.get('article').fire('click', { target: player.words[1] });
  assert.equal(audio.currentTime, 6);
  assert.equal(player.words.some(word => word.getAttribute('aria-current') === 'true'), false);
  await player.get('listen').fire('click');
  assert.equal(player.words.some(word => word.getAttribute('aria-current') === 'true'), false);
  await player.get('follow').fire('click');
  assert.equal(player.words[1].getAttribute('aria-current'), 'true');
  await player.get('play').fire('click');
  assert.equal(player.words.some(word => word.getAttribute('aria-current') === 'true'), false);
  audio.currentTime = 3; await audio.fire('timeupdate');
  assert.equal(player.words.some(word => word.getAttribute('aria-current') === 'true'), false);
  await player.get('skip-silence').fire('click'); await player.get('listen').fire('click');
  await audio.fire('timeupdate'); assert.equal(audio.currentTime, 6);
  let prevented = 0;
  const target = { closest: () => null };
  await player.page.fire('keydown', { code: 'Space', target, preventDefault: () => { prevented++; } });
  assert.equal(audio.paused, true);
  await player.page.fire('keydown', { code: 'ArrowLeft', target, preventDefault: () => { prevented++; } });
  assert.equal(audio.currentTime, 0);
  await player.page.fire('keydown', { code: 'Space', target: { closest: () => ({}) }, preventDefault: () => { prevented++; } });
  assert.equal(audio.paused, true);
  assert.equal(prevented, 2);
  player.get('article').getBoundingClientRect = () => ({ top: -300, bottom: 900, height: 1200 });
  Object.assign(player.page, { scrollY: 600 });
  await player.page.fire('scroll');
  assert.equal(player.get('reading-percent').textContent, '63%');
});

test('Шрифт автономной статьи совпадает с локальным Inter и не требует сетевой загрузки', () => {
  const html = createPublication(example(), true);
  const embedded = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/u.exec(html)?.[1];
  assert.ok(embedded);
  assert.deepEqual(Buffer.from(embedded, 'base64'), readFileSync(new URL('../inter-font.woff2', import.meta.url)));
});

test('Экспорт встраивает целиком общий CSS приложения вместо самостоятельной копии', async () => {
  const modulePath = '../src/lib/reader-styles.ts';
  const shared = await import(modulePath).catch(() => undefined);
  assert.ok(typeof shared?.APP_STYLES === 'string' && shared.APP_STYLES.length > 0, 'Отсутствует общий источник CSS');
  const html = createPublication(example(), true);
  const style = /<style>([\s\S]*?)<\/style>/u.exec(html)?.[1];
  assert.ok(style?.includes(shared.APP_STYLES), 'Автономная статья должна содержать общий CSS без преобразований');
});

test('Пользовательский текст и заголовок не могут добавить HTML или исполняемый код', () => {
  const document = example('# <img src=x onerror=alert(1)>\n\n</script><script>alert(1)</script>');
  document.title = '"><script>alert(2)</script>';
  const html = createPublication(document, true);
  assert.doesNotMatch(html, /<img|<script>alert/u);
  assert.match(html, /&lt;script&gt;alert\(2\)/u);
  assert.equal((html.match(/<script>/gu) ?? []).length, 1);
  assert.equal(publicationAudioName('страница.html'), 'article-audio.bin');
});

test('Код вставки требует публичный HTTP-адрес и экранирует атрибуты', () => {
  for (const address of ['javascript:alert(1)', 'data:text/html,test', '/reader/', 'blob:https://example.org/id', 'https://user:password@example.org/']) {
    assert.throws(() => createEmbedCode(address));
  }
  assert.match(createEmbedCode(' https://example.org/article.html?a=1&b=2 '), /a=1&amp;b=2/u);
  assert.match(createEmbedCode('https://example.org/" onload="alert(1)'), /%22/u);
});
