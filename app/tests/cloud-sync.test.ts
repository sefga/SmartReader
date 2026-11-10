import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { synchronizeCloudAudio } from '../src/lib/cloud-sync.ts';
import { findActiveWord, type ReadingDocument } from '../src/lib/sync.ts';

const originalFetch = globalThis.fetch;
const document: ReadingDocument = {
  title: 'Проверка', text: 'Первое слово. После паузы.', cues: [], duration: 10, position: 0, audioName: 'запись.mp3',
};
const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });
const key = 'test-key-never-show';
const openaiWords = [
  { word: 'первое', start: 1, end: 1.5 }, { word: 'слово', start: 1.5, end: 2 },
  { word: 'после', start: 6, end: 6.5 }, { word: 'паузы', start: 6.5, end: 7 },
];
const timingWords = [
  { word: 'Первое', start: 1, end: 1.5 }, { word: 'слово.', start: 1.5, end: 2 },
  { word: 'После', start: 6, end: 6.5 }, { word: 'паузы.', start: 6.5, end: 7 },
];

function geminiResponse(text: string, status = 'completed'): Response {
  return Response.json({ id: 'int_test', object: 'interaction', status, model: 'gemini-3.8-flash', steps: [
    { type: 'thought', content: [{ type: 'text', text: 'Не включать в результат.' }] },
    { type: 'model_output', content: [{ type: 'text', text }] },
  ] });
}

afterEach(() => { globalThis.fetch = originalFetch; });

test('OpenAI отправляет файл на официальный endpoint и сохраняет словные интервалы с паузой', async () => {
  const controller = new AbortController();
  const progress: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`);
    assert.equal(new Headers(init?.headers).has('content-type'), false);
    assert.ok(init?.body instanceof FormData);
    const body = init.body;
    assert.equal(body.get('model'), 'whisper-1');
    assert.equal(body.get('response_format'), 'verbose_json');
    assert.deepEqual(body.getAll('timestamp_granularities[]'), ['word']);
    const file = body.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'запись.mp3');
    assert.equal(file.size, 3);
    assert.equal([...body.values()].includes(key), false);
    return Response.json({ task: 'transcribe', language: 'russian', duration: 10, text: 'Первое слово. После паузы.', words: openaiWords });
  };
  const result = await synchronizeCloudAudio(document, audio, { provider: 'openai', apiKey: key }, controller.signal, value => progress.push(value.stage));
  assert.deepEqual(result.cues, timingWords);
  assert.equal(result.matched, 4);
  assert.equal(result.estimated, 0);
  assert.equal(result.boundaryWarning, false);
  assert.equal(findActiveWord(result.cues, 4), -1);
  assert.equal(progress.at(-1), 'done');
});

test('Gemini отправляет inline audio и JSON Schema, разбирает актуальные steps и помечает интервалы оценочными', async () => {
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-goog-api-key'), key);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.has('authorization'), false);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gemini-3.8-flash');
    assert.equal(body.store, false);
    assert.equal(typeof body.system_instruction, 'string');
    assert.ok(body.system_instruction.length > 0);
    assert.equal(body.input[0].type, 'text');
    assert.ok(body.input[0].text.includes('Первое'));
    assert.deepEqual(body.input[1], { type: 'audio', mime_type: 'audio/mpeg', data: 'AQID' });
    assert.equal(body.response_format.type, 'text');
    assert.equal(body.response_format.mime_type, 'application/json');
    assert.ok(body.response_format.schema);
    assert.equal(String(init?.body).includes(key), false);
    return geminiResponse(JSON.stringify({ words: timingWords }));
  };
  const result = await synchronizeCloudAudio(document, audio, { provider: 'gemini', apiKey: key }, controller.signal, () => {});
  assert.deepEqual(result.cues, timingWords);
  assert.equal(result.matched, 4);
  assert.equal(result.estimated, 4);
  assert.equal(result.boundaryWarning, true);
});

test('Gemini принимает текстовые блоки одного model_output без примеси thought', async () => {
  const json = JSON.stringify({ words: timingWords });
  globalThis.fetch = async () => Response.json({ status: 'completed', steps: [
    { type: 'thought', content: [{ type: 'text', text: 'Служебное рассуждение' }] },
    { type: 'model_output', content: [{ type: 'text', text: json.slice(0, 30) }, { type: 'text', text: json.slice(30) }] },
  ] });
  const result = await synchronizeCloudAudio(document, audio, { provider: 'gemini', apiKey: key, model: 'gemini-3.8-flash' }, new AbortController().signal, () => {});
  assert.deepEqual(result.cues, timingWords);
});

for (const [label, value] of [
  ['повреждённый JSON', '{"words":['],
  ['пропущенное слово', JSON.stringify({ words: timingWords.slice(0, 3) })],
  ['пересекающиеся интервалы', JSON.stringify({ words: [timingWords[0], { ...timingWords[1], start: 1.3 }, ...timingWords.slice(2)] })],
  ['чужой текст', JSON.stringify({ words: timingWords.map(item => ({ ...item, word: 'подмена' })) })],
  ['выход за длительность', JSON.stringify({ words: [...timingWords.slice(0, 3), { ...timingWords[3], end: 12 }] })],
  ['отказ модели', JSON.stringify({ error: `Отказ ${key}` })],
] as const) {
  test(`Gemini отвергает ${label} без отражения тела ответа`, async () => {
    globalThis.fetch = async () => geminiResponse(value);
    await assert.rejects(
      synchronizeCloudAudio(document, audio, { provider: 'gemini', apiKey: key }, new AbortController().signal, () => {}),
      (error: unknown) => error instanceof Error && /метк|интервал|JSON/iu.test(error.message) && !error.message.includes(key),
    );
  });
}

test('Gemini отвергает незавершённую генерацию даже с корректным фрагментом JSON', async () => {
  globalThis.fetch = async () => geminiResponse(JSON.stringify({ words: timingWords }), 'incomplete');
  await assert.rejects(synchronizeCloudAudio(document, audio, { provider: 'gemini', apiKey: key }, new AbortController().signal, () => {}), /заверш|обрез|метк/iu);
});

test('Текст без словных таймкодов OpenAI не выдаётся за готовую синхронизацию', async () => {
  globalThis.fetch = async () => Response.json({ text: 'Первое слово. После паузы.' });
  await assert.rejects(synchronizeCloudAudio(document, audio, { provider: 'openai', apiKey: key }, new AbortController().signal, () => {}), /метк|времен/iu);
});

for (const provider of ['openai', 'gemini'] as const) {
  for (const [status, message] of [[401, /ключ/iu], [403, /доступ|ключ/iu], [429, /лимит|квот/iu], [500, /сервис|ошибк/iu]] as const) {
    test(`${provider}: HTTP ${status} превращается в безопасную русскую ошибку`, async () => {
      globalThis.fetch = async () => new Response(`Секрет в сыром ответе: ${key}`, { status });
      await assert.rejects(
        synchronizeCloudAudio(document, audio, { provider, apiKey: key }, new AbortController().signal, () => {}),
        (error: unknown) => error instanceof Error && message.test(error.message) && !error.message.includes(key) && !error.message.includes('Секрет'),
      );
    });
  }

  test(`${provider}: сетевая ошибка не раскрывает ключ`, async () => {
    globalThis.fetch = async () => { throw new TypeError(`Network ${key}`); };
    await assert.rejects(
      synchronizeCloudAudio(document, audio, { provider, apiKey: key }, new AbortController().signal, () => {}),
      (error: unknown) => error instanceof Error && /сет|соедин|подключ/iu.test(error.message) && !error.message.includes(key),
    );
  });

  test(`${provider}: отменённая операция не обращается к API`, async () => {
    globalThis.fetch = async () => { assert.fail('После отмены запрос запрещён'); };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(synchronizeCloudAudio(document, audio, { provider, apiKey: key }, controller.signal, () => {}), { name: 'AbortError' });
  });

  test(`${provider}: отмена активного fetch сохраняет AbortError`, async () => {
    const controller = new AbortController();
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.signal, controller.signal);
      controller.abort();
      throw new DOMException('Прервано', 'AbortError');
    };
    await assert.rejects(synchronizeCloudAudio(document, audio, { provider, apiKey: key }, controller.signal, () => {}), { name: 'AbortError' });
  });

  test(`${provider}: отмена после получения ответа не применяет метки`, async () => {
    const controller = new AbortController();
    globalThis.fetch = async () => {
      controller.abort();
      return provider === 'openai' ? Response.json({ words: openaiWords }) : geminiResponse(JSON.stringify({ words: timingWords }));
    };
    await assert.rejects(synchronizeCloudAudio(document, audio, { provider, apiKey: key }, controller.signal, () => {}), { name: 'AbortError' });
  });

  test(`${provider}: пустой ключ и пустой файл отклоняются до отправки`, async () => {
    globalThis.fetch = async () => { assert.fail('Невалидные данные нельзя отправлять'); };
    await assert.rejects(synchronizeCloudAudio(document, audio, { provider, apiKey: '  ' }, new AbortController().signal, () => {}), /ключ/iu);
    await assert.rejects(synchronizeCloudAudio(document, new Blob([]), { provider, apiKey: key }, new AbortController().signal, () => {}), /аудио|файл/iu);
  });

  test(`${provider}: файл сверх лимита отклоняется до чтения и отправки`, async () => {
    globalThis.fetch = async () => { assert.fail('Большой файл нельзя отправлять'); };
    const oversized = new Blob([new Uint8Array((provider === 'openai' ? 25_000_000 : 12_000_000) + 1)], { type: 'audio/mpeg' });
    oversized.arrayBuffer = async () => { assert.fail('Большой файл нельзя читать'); };
    await assert.rejects(synchronizeCloudAudio(document, oversized, { provider, apiKey: key }, new AbortController().signal, () => {}), /МБ.*браузер|браузер.*МБ/iu);
  });
}

test('OpenAI не подменяет модель на text-only transcribe без словных таймкодов', async () => {
  globalThis.fetch = async () => { assert.fail('Несовместимую модель нельзя вызывать'); };
  await assert.rejects(synchronizeCloudAudio(document, audio, { provider: 'openai', apiKey: key, model: 'gpt-transcribe' }, new AbortController().signal, () => {}), /whisper-1|словн/iu);
});

test('Gemini отменяет чтение файла до отправки при изменении AbortSignal', async () => {
  const controller = new AbortController();
  const localAudio = new Blob(['test'], { type: 'audio/mpeg' });
  localAudio.arrayBuffer = async () => { controller.abort(); return new ArrayBuffer(4); };
  globalThis.fetch = async () => { assert.fail('После отмены чтения запрос запрещён'); };
  await assert.rejects(synchronizeCloudAudio(document, localAudio, { provider: 'gemini', apiKey: key }, controller.signal, () => {}), { name: 'AbortError' });
});

test('Gemini незамедлительно отменяет ожидание ещё читающегося файла', async () => {
  const controller = new AbortController();
  const localAudio = new Blob(['test'], { type: 'audio/mpeg' });
  let finishReading: (value: ArrayBuffer) => void = () => {};
  localAudio.arrayBuffer = () => new Promise(resolve => { finishReading = resolve; });
  globalThis.fetch = async () => { assert.fail('После отмены чтения запрос запрещён'); };
  const pending = synchronizeCloudAudio(document, localAudio, { provider: 'gemini', apiKey: key }, controller.signal, () => {});
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  finishReading(new ArrayBuffer(4));
});

test('Gemini ограничивает полный размер запроса с учётом UTF-8 текста', async () => {
  globalThis.fetch = async () => { assert.fail('Запрос сверх лимита нельзя отправлять'); };
  await assert.rejects(synchronizeCloudAudio({ ...document, title: 'я'.repeat(10_000_000) }, audio, { provider: 'gemini', apiKey: key }, new AbortController().signal, () => {}), /20 МБ/iu);
});

for (const [mime, name, expectedMime] of [
  ['audio/webm;codecs=opus', 'запись.webm', 'audio/webm'],
  ['audio/mp4', 'запись.m4a', 'audio/m4a'],
  ['audio/x-wav', 'запись.wav', 'audio/wav'],
  ['', 'запись.flac', 'audio/flac'],
] as const) {
  test(`Gemini передаёт поддерживаемый MIME ${expectedMime} для ${mime || name}`, async () => {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.input[1].mime_type, expectedMime);
      return geminiResponse(JSON.stringify({ words: timingWords }));
    };
    await synchronizeCloudAudio({ ...document, audioName: name }, new Blob(['test'], { type: mime }), { provider: 'gemini', apiKey: key }, new AbortController().signal, () => {});
  });
}

test('Gemini не выдаёт неизвестный контейнер за MP3', async () => {
  globalThis.fetch = async () => { assert.fail('Неизвестный контейнер нельзя отправлять'); };
  await assert.rejects(synchronizeCloudAudio({ ...document, audioName: 'запись.bin' }, new Blob(['test']), { provider: 'gemini', apiKey: key }, new AbortController().signal, () => {}), /формат|MP3/iu);
});

test('OpenAI сохраняет формат безымянного WAV вместо имени MP3', async () => {
  globalThis.fetch = async (_url, init) => {
    assert.ok(init?.body instanceof FormData);
    const file = init.body.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'audio.wav');
    return Response.json({ words: openaiWords });
  };
  await synchronizeCloudAudio({ ...document, audioName: undefined }, new Blob(['test'], { type: 'audio/wav' }), { provider: 'openai', apiKey: key }, new AbortController().signal, () => {});
});
