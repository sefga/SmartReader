'use client';
import { useEffect, useRef, useState } from 'react';
import { createEmbedCode, createPublication, publicationAudioName } from '../lib/publication';
import type { ReadingDocument } from '../lib/sync';
import Icon from './Icons';
import { convertToMp3 } from '../lib/mp3';

export default function Publish({ document, audio, exact, onImport }: { document: ReadingDocument; audio?: Blob; exact: boolean; onImport: () => void }) {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const cachedMp3 = useRef<{ source: Blob; file: File } | null>(null);
  const conversion = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;conversion.current?.abort();};},[]);
  let code = '';
  let addressError = '';
  if (address.trim()) {
    try { code = createEmbedCode(address); }
    catch (cause) { addressError = cause instanceof Error ? cause.message : 'Проверьте адрес страницы.'; }
  }

  function saveFile(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url; link.download = name;
    window.document.body.append(link);link.click();link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function download(kind: 'page' | 'audio'): Promise<void> {
    if (!audio || busy) return;
    setError('');setBusy(true);setStatus('Подготавливаем MP3…');
    const controller = new AbortController(); conversion.current = controller;
    try {
      const mp3 = cachedMp3.current?.source === audio ? cachedMp3.current.file : await convertToMp3(audio, document.audioName || 'article-audio', {
        signal: controller.signal,
        onProgress: value=>{if(mounted.current)setStatus(`Подготавливаем MP3 · ${Math.round(value*100)}%`);},
      });
      if (!mounted.current || controller.signal.aborted) return;
      cachedMp3.current = { source: audio, file: mp3 };
      const blob = kind === 'page' ? new Blob([createPublication({...document,audioName:mp3.name}, exact)], { type: 'text/html;charset=utf-8' }) : mp3;
      saveFile(blob, kind === 'page' ? 'article.html' : publicationAudioName(mp3.name));
      setStatus(kind === 'page' ? 'Страница подготовлена. Скачайте также MP3 и сохраните оба файла в одной папке.' : 'MP3 подготовлен. Для статьи сохраните article-audio.mp3 рядом с article.html.');
    } catch (cause) { if(mounted.current&&!controller.signal.aborted){setStatus('');setError(cause instanceof Error ? cause.message : 'Не удалось подготовить MP3. Исходный файл сохранён.');} }
    finally {if(mounted.current){setBusy(false);conversion.current=null;}}
  }

  async function copyCode(): Promise<void> {
    try { await navigator.clipboard.writeText(code);setCopied(true);setError(''); }
    catch { setError('Выделите код ниже и скопируйте вручную: Ctrl+C или «Копировать» на телефоне.'); }
  }

  return <div className="publish-panel">
    <div className="publication-note"><strong>Ваш личный архив статьи и озвучки</strong><p>Сохраните HTML-страницу и аудиофайл в одну папку. Текст и текущие метки слов включаются в HTML при экспорте.</p></div>
    <ol className="publish-steps">
      <li><strong>Подготовьте текст и звук</strong><p>Используйте готовый аудиофайл или «Записать звук вкладки» в форме добавления материала. После записи автоматически готовится MP3. При скачивании старые записи WebM также преобразуются в MP3 прямо на вашем устройстве.</p></li>
      <li><strong>Добавьте текст и готовое аудио</strong><p>Загрузите их в читалку и дождитесь автоматической синхронизации. Вы также можете добавить JSON с метками слов. MP3 сам по себе меток не содержит.</p><button className="text-action" onClick={onImport}>{audio ? 'Заменить материал' : 'Добавить материал'} <Icon name="arrow" size={16}/></button></li>
      <li><strong>Скачайте в одну папку</strong><p>Сохраните оба файла, не меняя имена. Откройте <code>article.html</code> в браузере. Страница содержит вашу статью, плеер и подсветку; аудиофайл должен лежать рядом.</p>
        {audio ? <><div className="publication-files"><button disabled={busy} onClick={()=>void download('page')}><Icon name="book" size={18}/><span>Скачать страницу<small>article.html</small></span></button><button disabled={busy} onClick={()=>void download('audio')}><Icon name="volume" size={18}/><span>Скачать аудио MP3<small>article-audio.mp3</small></span></button></div><p className="small-note">Материал: «{document.title}». {exact ? 'Метки из JSON включены в страницу.' : document.alignment ? 'Автоматические метки включены в страницу; проверьте их на слух.' : 'Разметка приблизительная.'} Сейчас он хранится только в вашем браузере; скачивание не публикует его автоматически.</p></> : <p className="publication-empty">Экспорт станет доступен после добавления вашего аудиофайла.</p>}
      </li>
    </ol>
    {audio && <form className="embed-form" onSubmit={event=>{event.preventDefault();if(code)void copyCode();}}>
      <label htmlFor="publication-address">Адрес загруженной страницы<input id="publication-address" type="url" value={address} onChange={event=>{setAddress(event.target.value);setCopied(false);}} placeholder="https://ваш-сайт.ru/audio/article.html" aria-describedby="embed-help" aria-invalid={Boolean(addressError)} required/></label>
      <p id="embed-help" className="small-note">Вставьте ссылку на HTML-страницу после загрузки на хостинг. Локальная ссылка на эту читалку для читателей не подойдёт.</p>
      {addressError && <p className="form-error" role="alert">{addressError}</p>}
      {code && <label>Код для HTML-блока на вашем сайте<textarea aria-label="Код вставки" value={code} readOnly rows={4} onFocus={event=>event.target.select()}/></label>}
      <button className="primary-button" type="submit" disabled={!code}>{copied ? 'Код скопирован ✓' : 'Скопировать код вставки'}</button>
    </form>}
    {status && <p className="publication-status" role="status">{status}</p>}
    {error && <><p className="form-error" role="alert">{error}</p>{audio&&<button className="text-action" onClick={()=>saveFile(audio,publicationAudioName(document.audioName))}>Скачать исходный файл без преобразования</button>}</>}
  </div>;
}
