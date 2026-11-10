'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from './Icons';
import Modal from './Modal';
import Publish from './Publish';
import AudioCapture from './AudioCapture';
import SynchronizationPanel from './SynchronizationPanel';
import { DEMO_TEXT, estimateCues, findActiveWord, formatTime, parseText, validateCues, type ReadingDocument, type WordCue } from '../lib/sync';
import type { CloudSyncOptions } from '../lib/cloud-sync';
import { loadReading, saveReading } from '../lib/storage';
import type { SyncProgress } from '../lib/auto-sync';
import { detectSilences, silenceEndAt, type AudioRange } from '../lib/silence';
import { parseMaterialFiles } from '../lib/import-files';

const initialWords = parseText(DEMO_TEXT).words;
const initialDuration = initialWords.length / 2.6;
const initialDocument: ReadingDocument = { title: 'Читать в своём ритме', text: DEMO_TEXT, cues: estimateCues(initialWords,initialDuration), duration: initialDuration, position: 0 };

export default function Reader() {
  const [document, setDocument] = useState<ReadingDocument>(initialDocument);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [fontSize, setFontSize] = useState(22);
  const [follow, setFollow] = useState(true);
  const [exact, setExact] = useState(false);
  const [ready, setReady] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob>();
  const [dialog, setDialog] = useState<'import'|'settings'|'timing'|'publish'|''>('');
  const [draftText, setDraftText] = useState(DEMO_TEXT);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftAudio, setDraftAudio] = useState<File>();
  const [draftTiming, setDraftTiming] = useState<File>();
  const [autoSync, setAutoSync] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [readingText, setReadingText] = useState(false);
  const [playerCollapsed, setPlayerCollapsed] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncProvider, setSyncProvider] = useState<'local' | 'openai' | 'gemini'>('local');
  const [silences, setSilences] = useState<AudioRange[] | null>(null);
  const [skipSilence, setSkipSilence] = useState(false);
  const [silenceBusy, setSilenceBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [bookmark, setBookmark] = useState<number | null>(null);
  const [readPercent, setReadPercent] = useState(0);
  const [section, setSection] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const article = useRef<HTMLElement>(null);
  const positionRef = useRef(0);
  const restorePosition = useRef(0);
  const speechGeneration = useRef(0);
  const syncController = useRef<AbortController | null>(null);
  const silenceController = useRef<AbortController | null>(null);
  const textImportGeneration = useRef(0);
  const {blocks, words} = useMemo(()=>parseText(document.text),[document.text]);
  const active = findActiveWord(document.cues,position);
  const headings = blocks.map((block,index)=>({block,index})).filter(({block})=>block.kind === 'heading');
  const audioPercent = document.duration ? Math.min(100, Math.round(position/document.duration*100)) : 0;
  const readAudioPosition = useCallback((): number => {
    const player = audio.current;
    if (!player) return 0;
    const end = !player.paused && skipSilence && silences ? silenceEndAt(silences,player.currentTime) : undefined;
    if (end !== undefined) player.currentTime = end;
    return player.currentTime;
  },[skipSilence,silences]);

  useEffect(()=> {
    if(window.innerWidth<=760) setFontSize(17);
    if(new URLSearchParams(window.location.search).get('publish')==='1') setDialog('publish');
    let cancelled = false;
    loadReading().then(saved=> {
      if (cancelled) return;
      if (!saved) {setCanSave(true);return;}
      const savedWords = parseText(saved.document.text).words;
      validateCues(saved.document.cues,savedWords,saved.document.duration);
      setDocument(saved.document);
      let current = saved.document.position;
      let mark: string | null = null;
      try {
        const savedPosition = localStorage.getItem('reader-position');
        if(savedPosition !== null) current = Number(savedPosition);
        mark = localStorage.getItem('reader-bookmark');
      } catch {setNotice('Позиция и закладка не сохраняются: localStorage недоступен.');}
      const restored = Math.min(saved.document.duration,Math.max(0,Number.isFinite(current) ? current : saved.document.position));
      restorePosition.current = restored;
      setPosition(restored);
      setDraftText(saved.document.text);
      setExact(saved.exact);
      setAudioBlob(saved.audio);
      if (mark !== null && Number.isFinite(Number(mark))) setBookmark(Number(mark));
      setCanSave(true);
    }).catch(()=>{if (!cancelled) setNotice('Хранилище недоступно. Можно читать и слушать, но данные не сохранятся.');}).finally(()=>{if (!cancelled) setReady(true);});
    return ()=>{cancelled=true; window.speechSynthesis?.cancel();};
  },[]);

  useEffect(()=> {
    if (!audioBlob) {setAudioUrl('');return;}
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return ()=>URL.revokeObjectURL(url);
  },[audioBlob]);

  useEffect(()=> {
    positionRef.current = position;
    if (!ready || !canSave) return;
    try {localStorage.setItem('reader-position',String(position));} catch { /* Хранилище может быть отключено в приватном режиме. */ }
  },[position,ready,canSave]);

  useEffect(()=> {
    if (!ready || !canSave) return;
    saveReading({document:{...document,position:positionRef.current},audio:audioBlob,exact}).catch(()=>setNotice('Не удалось сохранить материал. Возможно, закончилось место в браузере.'));
  },[document,audioBlob,exact,ready,canSave]);

  useEffect(()=> { if (audio.current) audio.current.playbackRate = rate; },[rate,audioUrl]);

  useEffect(()=>()=>{syncController.current?.abort();textImportGeneration.current++;},[]);

  useEffect(()=> {
    setSilences(null);setSkipSilence(false);setSilenceBusy(false);
    return ()=>{silenceController.current?.abort();silenceController.current=null;};
  },[audioBlob]);

  useEffect(()=> {
    if (!playing || !audioUrl) return;
    let frame = 0, lastWord = -2;
    const update = () => {
      const current = readAudioPosition();
      if (audio.current) {
        const word = findActiveWord(document.cues,current);
        if (word !== lastWord) {lastWord = word;setPosition(current);}
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return ()=>cancelAnimationFrame(frame);
  },[playing,audioUrl,document.cues,readAudioPosition]);

  useEffect(()=> {
    if (!follow || !playing || active < 0) return;
    const word = window.document.getElementById(`word-${active}`);
    const rect = word?.getBoundingClientRect();
    if (rect && (rect.top < 160 || rect.bottom > window.innerHeight-200)) word?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  },[active,follow,playing]);

  useEffect(()=> {
    const update = () => {
      const element = article.current;
      if (!element) return;
      const top = element.getBoundingClientRect().top + window.scrollY;
      const total = Math.max(1,element.offsetHeight-window.innerHeight+230);
      setReadPercent(Math.min(100,Math.max(0,Math.round((window.scrollY-top+150)/total*100))));
      let current = 0;
      element.querySelectorAll('[data-section]').forEach(node=>{if(node.getBoundingClientRect().top < 190) current=Number(node.getAttribute('data-section'));});
      setSection(current);
    };
    window.addEventListener('scroll',update,{passive:true});
    window.addEventListener('resize',update);
    update();
    return ()=>{window.removeEventListener('scroll',update);window.removeEventListener('resize',update);};
  },[document.text,fontSize]);

  const speak = useCallback((from: number) => {
    if (!('speechSynthesis' in window)) {setError('Браузер не поддерживает озвучку примера. Загрузите свой аудиофайл.');return;}
    const generation = ++speechGeneration.current;
    window.speechSynthesis.cancel();
    const index = Math.max(0,findActiveWord(document.cues,from));
    const spokenWords = words.slice(index);
    const utterance = new SpeechSynthesisUtterance(spokenWords.join(' '));
    utterance.lang = 'ru-RU';
    utterance.rate = rate;
    let cursor = 0;
    const offsets = spokenWords.map(word=>{const offset=cursor;cursor+=word.length+1;return offset;});
    utterance.onboundary = event => {
      if (generation !== speechGeneration.current) return;
      let wordIndex = offsets.findIndex(offset=>offset>event.charIndex)-1;
      if (wordIndex < 0) wordIndex=offsets.length-1;
      setPosition(document.cues[index+wordIndex]?.start ?? from);
    };
    utterance.onend = ()=>{if(generation===speechGeneration.current){setPlaying(false);setPosition(document.duration);}};
    utterance.onerror = event=>{if(generation===speechGeneration.current && event.error!=='interrupted' && event.error!=='canceled'){setPlaying(false);setError('Озвучка примера недоступна. Загрузите аудиофайл, чтобы слушать свою статью.');}};
    window.speechSynthesis.speak(utterance);
    setPlaying(true);
  },[document,words,rate]);

  function pause(): void {
    if (audioUrl) audio.current?.pause();
    else {speechGeneration.current++;window.speechSynthesis?.cancel();}
    setPlaying(false);
  }

  async function togglePlayback(): Promise<void> {
    setError('');
    if (playing) {pause();return;}
    if (audioUrl && audio.current) {
      if(position>=document.duration) audio.current.currentTime=0;
      try {await audio.current.play();} catch {setError('Не удалось воспроизвести файл. Попробуйте MP3, WAV или M4A.');}
    } else speak(position>=document.duration ? 0 : position);
  }

  function seek(time: number): void {
    const next = Math.min(document.duration,Math.max(0,time));
    setPosition(next);
    if(audioUrl && audio.current) audio.current.currentTime=next;
    else if(playing) speak(next);
  }

  useEffect(()=> {
    const key = (event: KeyboardEvent) => {
      const element=event.target as HTMLElement;
      if(!audioUrl || dialog || element.closest('input,textarea,select,button,a,[role="button"]')) return;
      if(event.code==='Space'){event.preventDefault();void togglePlayback();}
      if(event.code==='ArrowLeft'){event.preventDefault();seek(positionRef.current-15);}
      if(event.code==='ArrowRight'){event.preventDefault();seek(positionRef.current+15);}
    };
    window.addEventListener('keydown',key);
    return ()=>window.removeEventListener('keydown',key);
  });

  function openImport(): void {
    textImportGeneration.current++;
    pause();setReadingText(false);setDraftText(audioBlob?document.text:'');setDraftTitle(audioBlob?document.title:'');setDraftAudio(undefined);setDraftTiming(undefined);setDragging(false);setError('');setDialog('import');
  }

  async function toggleSilence(): Promise<void> {
    if (skipSilence) {setSkipSilence(false);return;}
    if (!audioBlob || silenceBusy) return;
    if (silences) {setSkipSilence(true);return;}
    const controller = new AbortController();silenceController.current=controller;setSilenceBusy(true);setError('');
    try {
      const ranges=await detectSilences(audioBlob,document.duration,{signal:controller.signal});
      if (controller.signal.aborted) return;
      setSilences(ranges);setSkipSilence(true);
      setNotice(ranges.length ? `Пропуск пауз включён: найдено ${ranges.length}.` : 'Длинные тихие паузы не найдены.');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось определить паузы.');
    } finally {if(silenceController.current===controller){silenceController.current=null;setSilenceBusy(false);}}
  }

  function cancelSync(showNotice = false): void {
    syncController.current?.abort();
    syncController.current = null;
    setSyncProgress(null);
    if (showNotice) setNotice('Синхронизация остановлена. Предыдущие метки сохранены.');
  }

  async function startSync(target: ReadingDocument, source: Blob, options?: CloudSyncOptions): Promise<void> {
    cancelSync();
    const controller = new AbortController();
    syncController.current = controller;
    setNotice('');setError('');setSyncProvider(options?.provider??'local');setSyncProgress({stage:'loading',progress:0});
    try {
      const updateProgress = (progress: SyncProgress): void => {
        if (syncController.current === controller) setSyncProgress(progress);
      };
      const result = options
        ? await (await import('../lib/cloud-sync')).synchronizeCloudAudio(target,source,options,controller.signal,updateProgress)
        : await (await import('../lib/auto-sync')).synchronizeAudio(target,source,controller.signal,updateProgress);
      if (syncController.current !== controller || controller.signal.aborted) return;
      setDocument(current=>current === target ? {...current,cues:result.cues,alignment:{matched:result.matched,total:result.total,estimated:result.estimated,boundaryWarning:result.boundaryWarning,source:options?.provider??'local'}} : current);
      setExact(false);
      setNotice(options?.provider==='gemini' ? 'Метки Gemini применены. Время слов оценено моделью; проверьте совпадение на слух.' : `Синхронизация завершена: совпало ${result.matched} из ${result.total} слов${result.estimated ? `, для ${result.estimated} время определено приблизительно` : ''}. ${result.boundaryWarning ? 'Не удалось уточнить границы фрагментов. ' : ''}Проверьте результат на слух.`);
    } catch (cause) {
      if (syncController.current !== controller || controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : '';
      setError(options && message ? message : /^(Совпало|Текст и запись|В записи|Для некоторых слов|Не удалось определить длительность)/u.test(message) ? message : 'Не удалось синхронизировать запись. Проверьте подключение к интернету и формат аудио, затем попробуйте ещё раз.');
    } finally {
      if (syncController.current === controller) {syncController.current=null;setSyncProgress(null);}
    }
  }

  async function addMaterialFiles(files: File[]): Promise<void> {
    if (busy || !files.length) return;
    let attempt: number | undefined;
    try {
      const selected = parseMaterialFiles(files);
      if (selected.audio && capturing) throw new Error('Завершите запись вкладки перед заменой аудио. Текст можно добавить сейчас.');
      if (selected.audio) setDraftAudio(selected.audio);
      setDraftTiming(undefined);setError('');
      if (selected.text) {
        attempt = ++textImportGeneration.current;
        setReadingText(true);setDraftTitle(selected.text.name.replace(/\.[^.]+$/u,''));
        const text = await selected.text.text();
        if (attempt === textImportGeneration.current) setDraftText(text);
      }
    } catch (cause) {
      if (attempt === undefined || attempt === textImportGeneration.current) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать файл.');
    } finally {
      if (attempt === textImportGeneration.current) setReadingText(false);
    }
  }

  async function importDocument(): Promise<void> {
    if (busy || capturing || readingText) return;
    const content = parseText(draftText);
    if(!content.words.length){setError('Добавьте текст статьи.');return;}
    if(content.words.length>30_000){setError('Для этой версии выберите статью до 30 000 слов.');return;}
    if(!draftAudio){setError('Выберите аудиофайл с озвучкой статьи.');return;}
    if(draftAudio.size>150_000_000){setError('Выберите аудиофайл меньше 150 МБ.');return;}
    setBusy(true);setError('');
    const url=URL.createObjectURL(draftAudio);
    const probe=new Audio();
    try {
      const duration=await new Promise<number>((resolve,reject)=>{
        const timeout=window.setTimeout(()=>reject(new Error('Не удалось определить длительность аудио.')),12000);
        probe.onloadedmetadata=()=>{clearTimeout(timeout);Number.isFinite(probe.duration)&&probe.duration>0 ? resolve(probe.duration):reject(new Error('Неподдерживаемый аудиофайл.'));};
        probe.onerror=()=>{clearTimeout(timeout);reject(new Error('Этот аудиофайл не поддерживается. Попробуйте MP3 или WAV.'));};
        probe.src=url;
      });
      if(draftTiming && draftTiming.size>5_000_000) throw new Error('Файл меток слишком большой. Максимум 5 МБ.');
      const cues=draftTiming ? validateCues(JSON.parse(await draftTiming.text()),content.words,duration) : estimateCues(content.words,duration);
      cancelSync();
      const nextDocument: ReadingDocument = {title:draftTitle.trim() || content.blocks[0]?.text.slice(0,90) || 'Моя статья',text:draftText.trim(),cues,duration,position:0,audioName:draftAudio.name};
      setDocument(nextDocument);
      restorePosition.current=0;setPosition(0);setBookmark(null);setAudioBlob(draftAudio);setPlayerCollapsed(false);setExact(Boolean(draftTiming));setCanSave(true);setDialog('');setNotice('Материал открыт. Текст и аудио сохраняются в этом браузере.');
      try {localStorage.setItem('reader-position','0');localStorage.removeItem('reader-bookmark');} catch { /* Чтение доступно и без локального хранилища. */ }
      window.scrollTo({top:0,behavior:'instant'});
      if (autoSync && !draftTiming) void startSync(nextDocument,draftAudio);
    } catch(cause) {setError(cause instanceof SyntaxError ? 'Не удалось прочитать метки. Проверьте формат JSON.' : cause instanceof Error ? cause.message : 'Не удалось открыть материал.');}
    finally {probe.removeAttribute('src');probe.load();URL.revokeObjectURL(url);setBusy(false);}
  }

  function applyTiming(cues: WordCue[]): void {
    cancelSync();pause();setDocument({...document,cues,alignment:undefined});setExact(true);setDialog('');setNotice('Метки JSON применены. Проверьте совпадение со звуком.');setError('');
  }

  function addBookmark(): void {
    setBookmark(position);
    try {localStorage.setItem('reader-bookmark',String(position));setNotice(`Закладка сохранена: ${formatTime(position)}.`);} catch {setNotice('Закладка доступна до закрытия страницы.');}
  }

  return <div className={`reader-app${!audioUrl ? ' without-audio' : playerCollapsed ? ' player-collapsed' : ''}`}>
    <header className="reader-topbar"><Link href="/" className="reader-brand" aria-label="speechread — главная"><Icon name="book" size={24}/><span>speechread</span></Link><div className="reader-top-actions"><button className="upload-button publish-button" onClick={()=>{pause();setError('');setDialog('publish');}} aria-label="Сохранить материал"><Icon name="arrow" size={17}/><span>Сохранить</span></button><button className="upload-button" onClick={openImport} aria-label="Добавить материал"><Icon name="upload" size={17}/><span>Добавить материал</span></button></div></header>
    <nav className="reading-nav" aria-label="Разделы статьи"><span className="reading-percent" title="Прогресс чтения">{readPercent}%</span><div className="section-links">{headings.map(({block,index})=><a href={`#section-${index}`} key={index} className={section===index?'is-active':''} onClick={()=>setFollow(false)}>{block.text}</a>)}</div><div className="reading-line"><span style={{width:`${readPercent}%`}}/></div></nav>
    <main className="reader-main">
      <div className="article-eyebrow"><span className="live-dot"/>{audioUrl ? 'ВАША СТАТЬЯ' : 'ПОПРОБУЙТЕ ЧИТАЛКУ'}<span>ТЕКСТ + АУДИО</span></div>
      <div className="article-title-row"><h1>{document.title}</h1><button className="icon-button" onClick={()=>setDialog('settings')} aria-label="Настройки чтения"><Icon name="settings"/></button></div>
      <div className="article-meta"><span>{words.length} слов</span><span>·</span><span>{Math.max(1,Math.ceil(document.duration/60))} мин</span><span>·</span><span>Сохранено на устройстве</span></div>
      <div className="reader-callout"><span className="callout-icon"><Icon name="volume"/></span><div><strong>Читайте. Слушайте. Следуйте за словами.</strong><p>{audioUrl ? 'Нажмите на слово, чтобы перейти к нему в аудио.' : 'Добавьте текст и аудиофайл своей статьи или послушайте пример.'}</p>{!audioUrl&&<button className="text-action demo-speech-button" onClick={()=>void togglePlayback()} disabled={!ready}>{playing?'Остановить пример':'Озвучить пример'}</button>}</div>{!audioUrl&&<button onClick={openImport} aria-label="Добавить свою статью"><Icon name="arrow"/></button>}</div>
      <button className="publication-cta" onClick={()=>{pause();setError('');setDialog('publish');}}>{audioUrl ? 'Скачать умную статью или аудио' : 'Как сохранить статью и озвучку'}<Icon name="arrow" size={16}/></button>
      <div className="reader-toolbar"><button className={follow?'follow-toggle enabled':'follow-toggle'} onClick={()=>setFollow(v=>!v)} aria-pressed={follow}><span className="toggle-track"><span/></span>Следить за текстом</button>{audioBlob&&<button className={skipSilence?'follow-toggle enabled':'follow-toggle'} onClick={()=>void toggleSilence()} disabled={silenceBusy} aria-pressed={skipSilence}><span className="toggle-track"><span/></span>{silenceBusy?'Поиск пауз…':'Пропускать паузы'}</button>}<button className="timing-button" aria-label="Способы синхронизации" onClick={()=>{setError('');setDialog('timing');}}>Синхронизация слов <span>ⓘ</span><small>{syncProgress ? 'Выполняется…' : exact ? '✓ Метки из JSON' : document.alignment?.source==='gemini' ? 'Оценка Gemini' : document.alignment?.source==='openai' ? '✓ OpenAI' : document.alignment ? '✓ Встроенный способ' : audioUrl ? '≈ Пока приблизительно' : 'Выбрать способ'}</small></button></div>
      <article ref={article} className="reading-article" style={{fontSize:`${fontSize}px`}} aria-label="Текст статьи">
        {blocks.map((block,index)=>{
          const text=words.slice(block.first,block.first+block.count).map((word,offset)=>{
            const wordIndex=block.first+offset;
            return <span key={wordIndex}><button id={`word-${wordIndex}`} className={`read-word ${active===wordIndex?'current-word':''}`} aria-current={active===wordIndex?'true':undefined} onClick={()=>seek(document.cues[wordIndex]?.start??0)} aria-label={`${word} — перейти к ${formatTime(document.cues[wordIndex]?.start??0)}`}>{word}</button>{' '}</span>;
          });
          return block.kind==='heading' ? <h2 id={`section-${index}`} data-section={index} key={index}>{text}</h2> : <p key={index}>{text}</p>;
        })}
      </article>
      <div className="article-end"><span>Вы дочитали до конца</span><button onClick={()=>{seek(0);window.scrollTo({top:0,behavior:'smooth'});}}>Вернуться к началу ↑</button></div>
    </main>
    {audioUrl&&<footer className="audio-player" id="audio-player-controls" aria-label="Аудиоплеер" hidden={playerCollapsed}>
      <div className="audio-player-inner"><div className="player-track"><span className="track-cover"><Icon name="book" size={22}/></span><div><strong>{document.title}</strong><span>{document.audioName || 'Пример · озвучка браузера'}</span></div></div>
        <div className="player-controls"><button className="skip-button" aria-label="Назад на 15 секунд" onClick={()=>seek(position-15)}><Icon name="back" size={25}/></button><button className="play-button" aria-label={playing?'Пауза':'Воспроизвести'} onClick={()=>void togglePlayback()} disabled={!ready}><Icon name={playing?'pause':'play'} size={24}/></button><button className="skip-button" aria-label="Вперёд на 15 секунд" onClick={()=>seek(position+15)}><Icon name="forward" size={25}/></button></div>
        <div className="player-options"><label className="speed-select"><span className="sr-only">Скорость воспроизведения</span><select value={rate} onChange={e=>{pause();setRate(Number(e.target.value));}}>{[0.5,0.75,1,1.25,1.5,1.75,2].map(value=><option key={value} value={value}>{value}×</option>)}</select></label><button className={`icon-button ${bookmark!==null?'bookmarked':''}`} onClick={addBookmark} aria-label="Поставить закладку"><Icon name="bookmark"/></button><button className="icon-button" onClick={()=>setPlayerCollapsed(true)} aria-label="Свернуть плеер" aria-controls="audio-player-controls" aria-expanded="true"><Icon name="close" size={18}/></button></div>
        <div className="player-timeline"><span>{formatTime(position)}</span><input aria-label="Позиция аудио" type="range" min="0" max={document.duration} step="0.05" value={position} onChange={e=>seek(Number(e.target.value))} style={{'--progress':`${audioPercent}%`} as React.CSSProperties}/><span>{formatTime(document.duration)}</span><span className="audio-percent">{audioPercent}%</span></div>
      </div>
    </footer>}
    {audioUrl&&playerCollapsed&&<div className="audio-mini-player" role="group" aria-label="Свёрнутый плеер"><button className="icon-button" aria-label={playing?'Пауза':'Воспроизвести'} onClick={()=>void togglePlayback()}><Icon name={playing?'pause':'play'} size={18}/></button><button className="show-player" onClick={()=>setPlayerCollapsed(false)} aria-controls="audio-player-controls" aria-expanded="false">Показать плеер <span>{formatTime(position)}</span></button></div>}
    {audioUrl&&<audio ref={audio} src={audioUrl} preload="metadata" onLoadedMetadata={()=>{if(audio.current){audio.current.currentTime=restorePosition.current;audio.current.playbackRate=rate;}}} onTimeUpdate={()=>setPosition(readAudioPosition())} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>{setPlaying(false);setError('Не удалось воспроизвести аудио. Выберите поддерживаемый файл.');}}/>}
    {syncProgress&&<div className="toast sync-toast" role="status"><span>{syncProvider!=='local'?`${syncProvider==='openai'?'OpenAI':'Gemini'} · Распознавание и проверка меток…`:<>{syncProgress.stage==='loading'?'Загрузка модели':syncProgress.stage==='decoding'?'Подготовка аудио':syncProgress.stage==='transcribing'?'Распознавание речи':syncProgress.stage==='refining'?'Уточнение стыков':'Сопоставление слов'} · {Math.round(Math.max(0,Math.min(1,syncProgress.progress))*100)}%</>}</span><button onClick={()=>cancelSync(true)}>Отменить</button></div>}
    {!syncProgress&&notice&&<div className="toast" role="status">{notice}<button aria-label="Скрыть уведомление" onClick={()=>setNotice('')}><Icon name="close" size={16}/></button></div>}
    {!syncProgress&&error&&!dialog&&<div className="toast error" role="alert">{error}<button aria-label="Закрыть ошибку" onClick={()=>setError('')}><Icon name="close" size={16}/></button></div>}
    {dialog&&<Modal title={dialog==='publish'?'Сохранить материал':dialog==='import'?'Добавить материал':dialog==='settings'?'Настройки чтения':'Синхронизация слов'} closeDisabled={busy||capturing} onClose={()=>{if(!busy&&!capturing){textImportGeneration.current++;setReadingText(false);setDialog('');setError('');}}}>
      {dialog==='publish'?<Publish document={document} audio={audioBlob} exact={exact} syncing={Boolean(syncProgress)} silences={silences} onSilences={setSilences} onImport={openImport}/>:dialog==='import'?<form className={`import-form${dragging?' is-dragging':''}`} onSubmit={e=>{e.preventDefault();void importDocument();}}
        onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';setDragging(true);}}}
        onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node | null))setDragging(false);}}
        onDrop={event=>{event.preventDefault();setDragging(false);void addMaterialFiles(Array.from(event.dataTransfer.files));}}>
        <p className="muted">Добавьте текст и звук в любом порядке. Файлы можно выбрать или перетащить сюда — по одному или вместе.</p>
        <div className="file-drop" role="group" aria-label="Аудиофайл">
          <label className="file-label" htmlFor="material-audio">Аудиофайл <span>Перетащите MP3, WAV, M4A, OGG, WebM или WEBA · до 150 МБ</span></label>
          <input id="material-audio" type="file" aria-label="Выбрать аудиофайл" accept="audio/*,.m4a,.webm,.weba,.mp4" onChange={event=>{void addMaterialFiles(Array.from(event.target.files??[]));event.target.value='';}} disabled={busy||capturing}/>
          {draftAudio&&<p className="small-note selected-audio" role="status">Аудио: {draftAudio.name}</p>}
        </div>
        <AudioCapture onCapture={file=>{setDraftAudio(file);setDraftTiming(undefined);setError('');}} onActiveChange={setCapturing}/>
        <label>Название<input value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} placeholder="Название статьи" maxLength={150}/></label>
        <div className="file-drop" role="group" aria-label="Текстовый файл">
          <label className="file-label" htmlFor="material-text">Текстовый файл <span>Перетащите TXT или Markdown · до 2 МБ</span></label>
          <input id="material-text" type="file" aria-label="Выбрать текстовый файл" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={event=>{void addMaterialFiles(Array.from(event.target.files??[]));event.target.value='';}} disabled={busy}/>
        </div>
        <label>Текст статьи<textarea aria-label="Текст статьи" value={draftText} onChange={e=>{textImportGeneration.current++;setReadingText(false);setDraftText(e.target.value);setDraftTiming(undefined);}} rows={5} placeholder="Вставьте текст. Начните заголовок с #, чтобы добавить раздел в оглавление." required/></label>
        <label className="auto-sync-option"><input type="checkbox" checked={autoSync} onChange={e=>setAutoSync(e.target.checked)} disabled={Boolean(draftTiming)}/><span>Автоматически синхронизировать слова с записью в браузере, без ключа</span></label>
        <p className="small-note">При первом запуске скачивается модель примерно 200 МБ. Она распознаёт запись на вашем устройстве, затем сопоставляет слова с текстом. Текст и аудио остаются в браузере. Заголовки должны звучать в записи.</p>
        <details><summary>Какие ещё есть способы синхронизации?</summary><p className="small-note">После создания статьи нажмите «Синхронизация слов» над текстом. Там доступны встроенный способ, OpenAI API, Gemini API, вставка готового JSON и промпты для другого чата. API использует ваш ключ и отправляет аудио выбранному сервису. Для быстрого открытия статьи можно отключить обработку сейчас и выбрать способ позже.</p></details>
        <details><summary>Есть готовые метки слов?</summary><label className="file-label">Метки слов <span>Необязательно · JSON</span><input type="file" accept=".json,application/json" onChange={e=>setDraftTiming(e.target.files?.[0])}/></label>{draftTiming&&<p className="small-note">Выбрано: {draftTiming.name}</p>}</details>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <div className="import-actions"><button className="primary-button" disabled={busy||capturing||readingText} type="submit">{busy?'Открываем материал…':capturing?'Завершите запись':readingText?'Читаем текст…':'Создать статью'}<Icon name="arrow" size={18}/></button></div>
      </form>:dialog==='settings'?<div className="settings-panel"><label>Размер текста <strong>{fontSize} px</strong><input type="range" min="16" max="30" value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}/></label><button className="setting-row" onClick={()=>setFollow(v=>!v)}>Автопрокрутка <span>{follow?'Включена':'Выключена'}</span></button>{bookmark!==null&&<button className="setting-row" onClick={()=>{seek(bookmark);setDialog('');}}>Перейти к закладке <span>{formatTime(bookmark)}</span></button>}<p className="muted">Пробел — пауза. Стрелки ← и → — перемотка на 15 секунд. Нажмите на слово, чтобы перейти к нему.</p></div>:<SynchronizationPanel document={document} exact={exact} hasAudio={Boolean(audioBlob)} syncing={Boolean(syncProgress)} onRun={options=>{if(audioBlob){setDialog('');void startSync(document,audioBlob,options);}}} onApply={applyTiming} onAddMaterial={openImport}/>}
    </Modal>}
  </div>;
}
