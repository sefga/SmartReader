'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLOUD_SYNC_DEFAULTS, type CloudSyncOptions } from '../lib/cloud-sync';
import { createTimingPrompts, parseTimingJson } from '../lib/timing-prompts';
import { parseText, type ReadingDocument, type WordCue } from '../lib/sync';

type Method = 'local' | 'openai' | 'gemini' | 'json' | 'prompt';
const methods: { value: Method; title: string; note: string }[] = [
  { value: 'local', title: 'Встроенный браузерный', note: 'Без ключа · аудио остаётся на устройстве' },
  { value: 'openai', title: 'OpenAI API', note: 'Ваш API-ключ · аудио отправляется в OpenAI' },
  { value: 'gemini', title: 'Gemini API', note: 'Ваш API-ключ · аудио и текст отправляются в Google' },
  { value: 'json', title: 'Готовая разметка JSON', note: 'Вставить ответ или выбрать файл с метками' },
  { value: 'prompt', title: 'Через чат с моделью', note: 'Готовые промпты → ответ JSON → вставка в читалку' },
];

export default function SynchronizationPanel({ document, exact, hasAudio, syncing, onRun, onApply, onAddMaterial }: {
  document: ReadingDocument; exact: boolean; hasAudio: boolean; syncing: boolean;
  onRun: (options?: CloudSyncOptions) => void; onApply: (cues: WordCue[]) => void; onAddMaterial: () => void;
}) {
  const [method, setMethod] = useState<Method>('local');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(CLOUD_SYNC_DEFAULTS.gemini);
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const prompts = useMemo(() => createTimingPrompts(document), [document]);
  const words = useMemo(() => parseText(document.text).words, [document.text]);
  const cloud = method === 'openai' || method === 'gemini';

  function applyJson(value = json): void {
    setError('');
    try { onApply(parseTimingJson(value, words, document.duration)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось применить метки.'); }
  }

  async function readJson(file?: File): Promise<void> {
    if (!file) return;
    if (file.size > 5_000_000) { setError('Файл меток слишком большой. Максимум 5 МБ.'); return; }
    const attempt = ++generation.current;
    try { const value = await file.text(); if (attempt === generation.current) { setJson(value); applyJson(value); } }
    catch { if (attempt === generation.current) setError('Не удалось прочитать файл JSON.'); }
  }

  async function copy(value: string, label: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); setStatus(`${label} скопирован.`); }
    catch { setStatus('Выделите текст в поле ниже и скопируйте его вручную: Ctrl+C.'); }
  }

  function run(): void {
    if (syncing || !hasAudio) return;
    if (!cloud) { onRun(); return; }
    if (!apiKey.trim()) { setError('Введите свой API-ключ выбранного сервиса.'); return; }
    const options: CloudSyncOptions = { provider: method, apiKey: apiKey.trim(), ...(method === 'gemini' ? { model: model.trim() } : {}) };
    setApiKey(''); onRun(options);
  }

  return <div className="synchronization-panel">
    <p>Подсветка следует за временем каждого слова. Выберите, как получить эти метки; способ можно сменить позже.</p>
    <p className="small-note">{exact ? 'Сейчас применены метки из JSON. Их формат проверен; точность времени нужно проверить на слух.' : document.alignment?.source === 'gemini' ? 'Сейчас применена оценка Gemini. Формат проверен; границы слов могут быть неточными.' : document.alignment ? `Сейчас используется ${document.alignment.source === 'openai' ? 'OpenAI' : 'встроенный способ'}: сопоставлено ${document.alignment.matched} из ${document.alignment.total} слов. Проверьте результат на слух.` : 'Пока используется приблизительное время по длине слов; паузы могут смещать подсветку.'}</p>
    <fieldset className="sync-methods"><legend>Способ создания разметки</legend>{methods.map(item => <label key={item.value} className={method === item.value ? 'sync-method selected' : 'sync-method'}><input type="radio" name="sync-method" value={item.value} checked={method === item.value} onChange={() => { generation.current++; setMethod(item.value); setApiKey(''); setError(''); setStatus(''); }}/><span><strong>{item.title}</strong><small>{item.note}</small></span></label>)}</fieldset>
    {method === 'local' && <section className="sync-explanation" aria-label="Как работает встроенный способ"><h3>Как это работает в браузере</h3><ol><li>Вы добавляете статью и запись того же текста.</li><li>При первом запуске скачивается модель Whisper — примерно 200 МБ. Для загрузки нужен интернет.</li><li>Модель распознаёт речь на вашем компьютере, затем читалка сопоставляет слова с текстом и сохраняет их время.</li><li>При прослушивании текущее время аудио определяет подсвеченное слово.</li></ol><p>API-ключ и аккаунт не нужны. Текст и аудио не отправляются на распознавание в облако. Модель может остаться в кеше браузера, но после очистки кеша потребуется новая загрузка.</p><p>Длинная запись обрабатывается дольше и нагружает устройство. Ошибки речи, непрочитанные заголовки и расхождения с текстом ухудшают результат. Это отдельный механизм; кнопка «Озвучить пример» только читает демонстрационный текст голосом браузера.</p><button className="primary-button" onClick={run} disabled={!hasAudio || syncing}>{syncing ? 'Синхронизация выполняется…' : 'Распознать в этом браузере'}</button></section>}
    {cloud && <section className="sync-explanation" aria-label={`Настройка ${method === 'openai' ? 'OpenAI' : 'Gemini'} API`}><h3>{method === 'openai' ? 'Распознавание через OpenAI' : 'Разметка через Gemini'}</h3><ol><li>Создайте API-ключ в {method === 'openai' ? <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">панели OpenAI</a> : <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>} и проверьте доступ к API и оплату.</li><li>Вставьте ключ ниже. Он используется только для запроса и не сохраняется в браузерном хранилище или статье.</li><li>Нажмите отправку и затем проверьте несколько слов на слух.</li></ol><p>{method === 'openai' ? 'В OpenAI отправится запись до 25 МБ. Используются метки слов whisper-1; модель доступна до 26.02.2027.' : 'В Google отправятся запись до 12 МБ и текст статьи. Время слов оценивает модель: это не гарантия точного совпадения.'} Запрос может быть платным. Для большей записи используйте встроенный способ или подготовьте отдельный фрагмент.</p><label>API-ключ {method === 'openai' ? 'OpenAI' : 'Gemini'}<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Введите свой API-ключ"/></label>{method === 'gemini' && <label>Модель Gemini<input value={model} onChange={event => setModel(event.target.value)} spellCheck={false}/></label>}<button className="primary-button" onClick={run} disabled={!hasAudio || syncing || !apiKey.trim()}>{`Отправить аудио в ${method === 'openai' ? 'OpenAI' : 'Gemini'} и создать метки`}</button></section>}
    {method === 'prompt' && <section className="sync-explanation"><h3>Получить JSON в другом чате</h3><ol><li>Откройте модель, которая умеет прослушивать прикреплённое аудио, и загрузите ту же запись.</li><li>Скопируйте системный промпт и задание ниже. Если отдельного поля системной инструкции нет, отправьте оба текста одним сообщением.</li><li>Получите полный JSON и вставьте его в поле разметки ниже. Если модель не может прослушать файл, текстового промпта недостаточно.</li></ol><p>Чатовая модель может ошибаться во времени слов. Промпт задаёт нужный формат, а проверка читалки проверяет структуру и порядок слов; точность сверяйте на слух.</p><button className="upload-button" onClick={() => void copy(prompts.system, 'Системный промпт')}>Скопировать системный промпт</button><details><summary>Показать системный промпт</summary><textarea aria-label="Системный промпт" value={prompts.system} readOnly rows={7} onFocus={event => event.target.select()}/></details><button className="upload-button" onClick={() => void copy(prompts.user, 'Запрос к модели')}>Скопировать задание со статьёй</button><details><summary>Показать задание со статьёй</summary><textarea aria-label="Задание со статьёй" value={prompts.user} readOnly rows={7} onFocus={event => event.target.select()}/></details></section>}
    {(method === 'json' || method === 'prompt') && <section className="sync-explanation"><h3>Вставить разметку</h3><p>Одна метка на каждое слово, включая заголовки; время — в секундах. Подходит массив или объект с полем words. Можно вставить целый JSON-блок из чата.</p><pre>{'{"words":[{"word":"Привет","start":0.2,"end":0.6},\n{"word":"мир.","start":0.7,"end":1.2}]}'}</pre><label>Ответ модели или JSON с метками<textarea aria-label="JSON с метками" value={json} onChange={event => { generation.current++; setJson(event.target.value); }} rows={7} placeholder="Вставьте полный JSON для вашей статьи"/></label><button className="primary-button" disabled={!hasAudio || !json.trim()} onClick={() => applyJson()}>Проверить и применить JSON</button><label className="file-label">Или выбрать файл JSON<input type="file" accept=".json,application/json" disabled={!hasAudio} onChange={event => void readJson(event.target.files?.[0])}/></label></section>}
    {!hasAudio && <div className="publication-note"><p>Чтобы создать и применить метки, сначала добавьте статью и её аудио.</p><button className="upload-button" onClick={onAddMaterial}>Добавить текст и аудио</button></div>}
    {status && <p role="status" className="small-note">{status}</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
