import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedCode, createPublication, publicationAudioName } from '../src/lib/publication.ts';
import { estimateCues, parseText, type ReadingDocument } from '../src/lib/sync.ts';

function example(text = '# Начало\n\nМоя статья.'): ReadingDocument {
  return { title: 'Моя статья', text, cues: estimateCues(parseText(text).words, 12), duration: 12, position: 0, audioName: 'озвучка.WAV' };
}

test('Экспорт включает текст, метки и переносимую ссылку на скачанное аудио', () => {
  const html = createPublication(example(), true);
  assert.match(html, /src="\.\/article-audio\.wav"/u);
  assert.match(html, /Точные метки слов/u);
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
