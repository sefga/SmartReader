'use client';
import { useEffect, useRef, useState } from 'react';
import { createEmbedCode, createStandalonePublication, publicationAudioName } from '../lib/publication';
import { detectSilences, remapCuesAfterSilence, type AudioRange } from '../lib/silence';
import type { ReadingDocument } from '../lib/sync';
import Icon from './Icons';
import { convertToMp3, removeSilenceToMp3 } from '../lib/mp3';
import { downloadFile } from '../lib/download';

export default function Publish({ document, audio, exact, syncing, silences, onSilences, onImport }: {
  document: ReadingDocument; audio?: Blob; exact: boolean; syncing: boolean;
  silences: AudioRange[] | null; onSilences: (ranges: AudioRange[]) => void; onImport: () => void;
}) {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removePauses, setRemovePauses] = useState(false);
  const cachedMp3 = useRef<{ source: Blob; file: File; trimmed: boolean } | null>(null);
  const conversion = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;conversion.current?.abort();};},[]);
  let code = '', addressError = '';
  if (address.trim()) {
    try {code = createEmbedCode(address);}
    catch (cause) {addressError = cause instanceof Error ? cause.message : 'Проверьте адрес страницы.';}
  }

  async function download(kind: 'page' | 'audio'): Promise<void> {
    if (!audio || busy || (kind === 'page' && syncing)) return;
    setError('');setBusy(true);setStatus('Подготавливаем запись…');
    const controller = new AbortController();conversion.current = controller;
    try {
      let ranges = silences;
      let warning = '';
      if ((kind === 'page' || removePauses) && ranges === null) {
        try {
          ranges = await detectSilences(audio,document.duration,{
            signal:controller.signal,
            onProgress:value=>{if(mounted.current)setStatus(`Ищем длинные паузы · ${Math.round(value*100)}%`);},
          });
          if (mounted.current && !controller.signal.aborted) onSilences(ranges);
        } catch (cause) {
          controller.signal.throwIfAborted();
          if (removePauses) throw cause;
          ranges = [];
          warning = ' Не удалось определить паузы; страница сохранена с исходной записью.';
        }
      }
      const cuts = removePauses ? ranges ?? [] : [];
      const mapped = kind === 'page' && cuts.length ? remapCuesAfterSilence(document.cues,cuts,document.duration) : undefined;
      setStatus(cuts.length ? 'Удаляем длинные паузы и готовим MP3…' : 'Подготавливаем MP3…');
      const trimmed = cuts.length > 0;
      const mp3 = cachedMp3.current?.source === audio && cachedMp3.current.trimmed === trimmed ? cachedMp3.current.file
        : trimmed ? await removeSilenceToMp3(audio,document.audioName || 'article-audio',cuts,document.duration,{
          signal:controller.signal,onProgress:value=>{if(mounted.current)setStatus(`Удаляем паузы · ${Math.round(value*100)}%`);},
        }) : await convertToMp3(audio,document.audioName || 'article-audio',{
          signal:controller.signal,onProgress:value=>{if(mounted.current)setStatus(`Подготавливаем MP3 · ${Math.round(value*100)}%`);},
        });
      controller.signal.throwIfAborted();
      cachedMp3.current = {source:audio,file:mp3,trimmed};
      if (kind === 'audio') {
        downloadFile(mp3,publicationAudioName(mp3.name));
        setStatus(trimmed?'MP3 без длинных пауз подготовлен.':'MP3 подготовлен для скачивания.');
      } else {
        const outputDocument = mapped ? {...document,cues:mapped.cues,duration:mapped.duration,position:0} : document;
        const html = await createStandalonePublication(outputDocument,exact,mp3,{
          silences:trimmed ? [] : ranges ?? [],signal:controller.signal,
          onProgress:value=>{if(mounted.current)setStatus(`Встраиваем аудио в страницу · ${Math.round(value*100)}%`);},
        });
        controller.signal.throwIfAborted();
        downloadFile(html,'article.html');
        setStatus(`Готово: один HTML-файл содержит статью, аудио и подсветку.${warning}`);
      }
    } catch (cause) {
      if(mounted.current&&!controller.signal.aborted){setStatus('');setError(cause instanceof Error ? cause.message : 'Не удалось подготовить файл.');}
    } finally {if(mounted.current){setBusy(false);conversion.current=null;}}
  }

  async function copyCode(): Promise<void> {
    try {await navigator.clipboard.writeText(code);setCopied(true);setError('');}
    catch {setError('Выделите код ниже и скопируйте вручную: Ctrl+C.');}
  }

  return <div className="publish-panel">
    <div className="publication-note"><strong>Выберите, что сохранить</strong><p>Умная статья — один HTML-файл со встроенными звуком, текстом и подсветкой. Его можно открыть в браузере и передать читателю.</p></div>
    {audio ? <>
      <p className="small-note">Материал: «{document.title}». {exact ? 'Используются метки из JSON.' : document.alignment ? 'Используются автоматические метки; проверьте их на слух.' : 'Разметка приблизительная.'}</p>
      {syncing&&<p className="publication-status" role="status">Дождитесь завершения синхронизации, чтобы включить готовую подсветку в статью.</p>}
      <label className="auto-sync-option trim-option"><input type="checkbox" checked={removePauses} onChange={event=>setRemovePauses(event.target.checked)} disabled={busy}/><span>Удалить длинные паузы из скачиваемого файла</span></label>
      <p className="small-note">Оригинал в читалке не изменится. Тихие участки длиннее 1,2 секунды сокращаются; проверьте результат на слух.</p>
      <div className="publication-files"><button disabled={busy||syncing} onClick={()=>void download('page')}><Icon name="book" size={18}/><span>Скачать умную статью<small>Один HTML: текст + аудио</small></span></button><button disabled={busy} onClick={()=>void download('audio')}><Icon name="volume" size={18}/><span>Скачать только аудио<small>MP3 для обычных плееров</small></span></button></div>
      <p className="small-note">HTML-файл увеличится примерно на треть от размера MP3. Для больших записей подготовка может занять время.</p>
      <details className="embed-form"><summary>Код для вставки на сайт</summary><p className="small-note">После загрузки HTML на свой сайт укажите его адрес.</p><form onSubmit={event=>{event.preventDefault();if(code)void copyCode();}}><label htmlFor="publication-address">Адрес страницы<input id="publication-address" type="url" value={address} onChange={event=>{setAddress(event.target.value);setCopied(false);}} placeholder="https://ваш-сайт.ru/article.html" aria-invalid={Boolean(addressError)} required/></label>{addressError&&<p className="form-error" role="alert">{addressError}</p>}{code&&<label>Код для HTML-блока<textarea aria-label="Код вставки" value={code} readOnly rows={4} onFocus={event=>event.target.select()}/></label>}<button className="primary-button" type="submit" disabled={!code}>{copied?'Код скопирован ✓':'Скопировать код вставки'}</button></form></details>
    </> : <div className="publication-empty"><p>Сначала добавьте текст и аудио.</p><button className="text-action" onClick={onImport}>Добавить материал <Icon name="arrow" size={16}/></button></div>}
    {status&&<p className="publication-status" role="status">{status}</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </div>;
}
