import { alignRecognizedWords, type AlignmentResult, type RecognizedWord } from './alignment.ts';
import type { SyncProgress } from './auto-sync.ts';
import { parseText, type ReadingDocument } from './sync.ts';
import { createTimingPrompts, parseTimingJson } from './timing-prompts.ts';

export type CloudSyncProvider = 'openai' | 'gemini';
export interface CloudSyncOptions { provider: CloudSyncProvider; apiKey: string; model?: string }
export const CLOUD_SYNC_DEFAULTS = { openai: 'whisper-1', gemini: 'gemini-3.8-flash' };

const GEMINI_TIMING_SCHEMA = {
  anyOf: [
    {
      type: 'object', additionalProperties: false, required: ['words'],
      properties: {
        words: {
          type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['word', 'start', 'end'],
            properties: { word: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
          },
        },
      },
    },
    { type: 'object', additionalProperties: false, required: ['error'], properties: { error: { type: 'string' } } },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Нормализует MIME контейнера, не переименовывая неизвестный формат в MP3. */
function audioMetadata(audio: Blob, document: ReadingDocument, provider: CloudSyncProvider): { name: string; mime: string } {
  const name = document.audioName || (audio instanceof File ? audio.name : '');
  const aliases = new Map([
    ['audio/mp4', 'audio/m4a'], ['audio/x-m4a', 'audio/m4a'], ['audio/x-wav', 'audio/wav'],
    ['audio/wave', 'audio/wav'], ['audio/vnd.wave', 'audio/wav'], ['audio/x-aiff', 'audio/aiff'],
    ['audio/x-flac', 'audio/flac'], ['application/ogg', 'audio/ogg'], ['video/webm', 'audio/webm'],
  ]);
  const extensions = new Map([
    ['mp3', 'audio/mpeg'], ['mpga', 'audio/mpeg'], ['mpeg', 'audio/mpeg'], ['wav', 'audio/wav'],
    ['mp4', 'audio/m4a'], ['m4a', 'audio/m4a'], ['webm', 'audio/webm'], ['aiff', 'audio/aiff'],
    ['aif', 'audio/aiff'], ['aac', 'audio/aac'], ['ogg', 'audio/ogg'], ['oga', 'audio/ogg'],
    ['flac', 'audio/flac'], ['opus', 'audio/opus'],
  ]);
  const rawMime = audio.type.split(';')[0].trim().toLowerCase();
  const mime = aliases.get(rawMime) || ((!rawMime || rawMime === 'application/octet-stream') ? extensions.get(name.split('.').at(-1)?.toLowerCase() || '') || '' : rawMime);
  if (provider === 'gemini' && !new Set([
    'audio/wav', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/mpeg',
    'audio/m4a', 'audio/l16', 'audio/opus', 'audio/alaw', 'audio/mulaw', 'audio/webm',
  ]).has(mime)) throw new Error('Gemini не поддерживает этот формат аудио. Экспортируйте запись в MP3, WAV или WebM.');
  const extension = [...extensions].find(([, type]) => type === mime)?.[0] || (mime === 'audio/mp3' ? 'mp3' : '');
  if (!name && !extension) throw new Error('Не удалось определить формат аудио. Выберите файл MP3, WAV или WebM.');
  return { name: name || `audio.${extension}`, mime };
}

/** Отправляет запрос без повторов и скрывает тело ошибки, которое может содержать секреты. */
async function requestJson(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal, redirect: 'error' });
  } catch {
    signal.throwIfAborted();
    throw new Error('Не удалось подключиться к API. Проверьте сеть и доступ браузера к сервису.');
  }
  signal.throwIfAborted();
  if (response.status === 401) throw new Error('API отклонил ключ. Проверьте ключ выбранного провайдера.');
  if (response.status === 403) throw new Error('Нет доступа к API или выбранной модели. Проверьте разрешения ключа.');
  if (response.status === 429) throw new Error('Достигнут лимит API или исчерпана квота. Проверьте баланс и повторите позже.');
  if (!response.ok) throw new Error('Облачный сервис вернул ошибку. Проверьте файл и доступность модели.');
  try {
    const value: unknown = await response.json();
    signal.throwIfAborted();
    return value;
  } catch {
    signal.throwIfAborted();
    throw new Error('API вернул некорректный JSON с метками времени. Повторите попытку.');
  }
}

/** Прерывает ожидание чтения Blob; браузерное чтение arrayBuffer само не принимает signal. */
async function readAudio(audio: Blob, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    audio.arrayBuffer().then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason); else reject(new Error('Не удалось прочитать аудиофайл. Загрузите его повторно.'));
    });
  });
}

/** Кодирует только ограниченный по размеру файл, периодически отдавая браузеру управление для отмены. */
async function audioBase64(audio: Blob, signal: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(await readAudio(audio, signal));
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    signal.throwIfAborted();
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    if (offset > 0 && offset % (1024 * 1024) === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return btoa(parts.join(''));
}

function parseOpenAiWords(value: unknown, duration: number): RecognizedWord[] {
  const invalid = () => new Error('OpenAI не вернул корректные словные метки времени. Для этого режима нужна модель whisper-1.');
  if (!isRecord(value) || !Array.isArray(value.words) || !value.words.length) throw invalid();
  let previousEnd = 0;
  return value.words.map((item: unknown) => {
    if (!isRecord(item) || typeof item.word !== 'string' || !item.word.trim()
      || typeof item.start !== 'number' || typeof item.end !== 'number'
      || !Number.isFinite(item.start) || !Number.isFinite(item.end)
      || item.start < previousEnd || item.end <= item.start || item.end > duration + 0.1) throw invalid();
    previousEnd = item.end;
    return { text: item.word, start: item.start, end: item.end };
  });
}

/** Читает текущую REST-схему Interactions; output_text существует только как удобное свойство SDK. */
function geminiOutput(value: unknown): string {
  if (!isRecord(value) || value.status !== 'completed' || !Array.isArray(value.steps)) {
    throw new Error('Gemini не завершил генерацию меток. Сократите аудио или повторите попытку.');
  }
  const outputs = value.steps.filter((step: unknown) => isRecord(step) && step.type === 'model_output');
  const output: unknown = outputs.at(-1);
  if (!isRecord(output) || !Array.isArray(output.content)) throw new Error('Gemini не вернул JSON с метками времени.');
  const parts = output.content;
  if (!parts.length || parts.some((part: unknown) => !isRecord(part) || part.type !== 'text' || typeof part.text !== 'string')) {
    throw new Error('Gemini не вернул текстовый JSON с метками времени.');
  }
  return parts.map((part: Record<string, unknown>) => part.text).join('');
}

/**
 * Сопоставляет текст с облачными словными интервалами; ключ используется только в заголовке одного запроса.
 *
 * OpenAI: whisper-1 выбран ради verbose_json + word timestamps; модель отключается 26.02.2027.
 * Gemini: интервалы создаёт мультимодальная модель, поэтому все слова помечаются оценочными.
 */
export async function synchronizeCloudAudio(document: ReadingDocument, audio: Blob, options: CloudSyncOptions, signal: AbortSignal, onProgress: (progress: SyncProgress) => void): Promise<AlignmentResult & { boundaryWarning: boolean }> {
  signal.throwIfAborted();
  if (options.provider !== 'openai' && options.provider !== 'gemini') throw new Error('Выберите поддерживаемый облачный API.');
  const apiKey = options.apiKey.trim();
  if (!apiKey || /[\r\n]/u.test(apiKey)) throw new Error('Введите корректный API-ключ выбранного провайдера.');
  if (!audio.size) throw new Error('Аудиофайл пуст. Загрузите запись со звуком.');
  const limit = options.provider === 'openai' ? 25_000_000 : 12_000_000;
  if (audio.size > limit) throw new Error(`Для ${options.provider === 'openai' ? 'OpenAI' : 'Gemini'} файл должен быть не больше ${limit / 1_000_000} МБ. Выберите распознавание в браузере или разделите запись.`);
  const words = parseText(document.text).words;
  if (!words.length || !Number.isFinite(document.duration) || document.duration <= 0) throw new Error('Загрузите текст и аудио с известной длительностью.');
  const model = options.model?.trim() || CLOUD_SYNC_DEFAULTS[options.provider];
  if (options.provider === 'openai' && model !== 'whisper-1') throw new Error('Словные метки OpenAI доступны в этом режиме только у whisper-1.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(model)) throw new Error('Укажите корректное имя модели API.');
  const metadata = audioMetadata(audio, document, options.provider);
  onProgress({ stage: 'loading', progress: 0 });
  signal.throwIfAborted();

  if (options.provider === 'openai') {
    const body = new FormData();
    body.append('file', audio, metadata.name);
    body.append('model', model);
    body.append('response_format', 'verbose_json');
    body.append('timestamp_granularities[]', 'word');
    onProgress({ stage: 'transcribing', progress: 0 });
    const value = await requestJson('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body,
    }, signal);
    signal.throwIfAborted();
    const result = alignRecognizedWords(words, parseOpenAiWords(value, document.duration), document.duration);
    signal.throwIfAborted();
    onProgress({ stage: 'done', progress: 1 });
    return { ...result, boundaryWarning: false };
  }

  const { system, user } = createTimingPrompts(document);
  const data = await audioBase64(audio, signal);
  const body = JSON.stringify({
    model, store: false, system_instruction: system,
    input: [{ type: 'text', text: user }, { type: 'audio', mime_type: metadata.mime, data }],
    response_format: { type: 'text', mime_type: 'application/json', schema: GEMINI_TIMING_SCHEMA },
  });
  if (new Blob([body]).size > 20_000_000) throw new Error('Запрос Gemini превышает 20 МБ вместе с текстом. Выберите распознавание в браузере или разделите запись.');
  signal.throwIfAborted();
  onProgress({ stage: 'transcribing', progress: 0 });
  const value = await requestJson('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body,
  }, signal);
  signal.throwIfAborted();
  const text = geminiOutput(value);
  let cues;
  try {
    cues = parseTimingJson(text, words, document.duration);
  } catch {
    throw new Error('Gemini вернул некорректные или неполные метки времени. Проверьте текст, аудио и повторите попытку.');
  }
  signal.throwIfAborted();
  onProgress({ stage: 'done', progress: 1 });
  return { cues, matched: cues.length, total: cues.length, estimated: cues.length, boundaryWarning: true };
}
