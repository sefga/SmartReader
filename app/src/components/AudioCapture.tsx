'use client';
import { useEffect, useRef, useState } from 'react';
import { captureTabAudio, type AudioRecording } from '../lib/recording';
import { formatTime } from '../lib/sync';
import { convertToMp3 } from '../lib/mp3';
import { loadCapturedAudio, saveCapturedAudio } from '../lib/storage';
import { downloadFile } from '../lib/download';
import { createCaptureJournal, loadCaptureJournal, clearCaptureJournal, type CaptureJournal } from '../lib/capture-journal';

export default function AudioCapture({ onCapture, onActiveChange }: {
  onCapture: (file: File) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'finishing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File>();
  const [download, setDownload] = useState<{ file: File; url: string }>();
  const [progress, setProgress] = useState(0);
  const [restored, setRestored] = useState(false);
  const [unfinished, setUnfinished] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const current = useRef<AudioRecording | null>(null);
  const journal = useRef<CaptureJournal | null>(null);
  const recoveryId = useRef<string | null>(null);
  const cancelledAttempts = useRef(new Set<number>());
  const conversion = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const active = phase !== 'idle';

  useEffect(() => {
    mounted.current = true;
    let live = true;
    const loadGeneration = generation.current;
    Promise.allSettled([loadCaptureJournal(), loadCapturedAudio()]).then(([pending, last]) => {
      if (!live || !mounted.current || generation.current !== loadGeneration) return;
      if (pending.status === 'fulfilled' && pending.value) {
        setFile(pending.value.file); setSeconds(pending.value.elapsedMs / 1000); setRestored(true); setUnfinished(true);
        recoveryId.current = pending.value.sessionId;
      } else if (last.status === 'fulfilled' && last.value) { setFile(last.value); setRestored(true); }
      if (pending.status === 'rejected' || last.status === 'rejected') setError('Не удалось восстановить часть записей из браузера. Сохраните доступный файл вручную.');
    });
    const flush = (): void => { current.current?.flush(); };
    const hidden = (): void => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', flush);
    return () => {
      live = false; mounted.current = false; generation.current++;
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', flush);
      // Размонтирование и перезагрузка сохраняют журнал; удаление разрешено только явной отменой.
      current.current?.flush(); current.current?.stop(); conversion.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setDownload({ file, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (!active) return;
    const preventClose = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventClose);
    return () => window.removeEventListener('beforeunload', preventClose);
  }, [active]);

  async function start(): Promise<void> {
    const attempt = ++generation.current;
    let sourceSaved = false;
    setError('');setSavedMessage(''); setSeconds(0); setPhase('requesting'); onActiveChange(true);
    try {
      const activeJournal = createCaptureJournal();
      journal.current = activeJournal;
      const recording = await captureTabAudio(value => { if (mounted.current && attempt === generation.current) setSeconds(value); }, async (chunk, elapsedMs) => {
        try { await activeJournal.append(chunk, elapsedMs); }
        catch (cause) {
          if (mounted.current && attempt === generation.current) setError('Не удалось сохранить промежуточную запись в браузере. Запись продолжается; после остановки скачайте файл вручную.');
          throw cause;
        }
      });
      if (!mounted.current || attempt !== generation.current) {
        if (cancelledAttempts.current.has(attempt)) recording.cancel(); else recording.stop();
        await recording.result.catch(() => undefined);
        if (cancelledAttempts.current.has(attempt)) await activeJournal.clear().catch(() => undefined);
        return;
      }
      current.current = recording; setPhase('recording');
      const captured = await recording.result;
      if (!mounted.current || attempt !== generation.current) return;
      setFile(captured.file);setRestored(false);setUnfinished(false);
      if(captured.warning)setError(captured.warning);
      if (captured.partial) {
        setRestored(true); setUnfinished(true); recoveryId.current = activeJournal.sessionId;
        return;
      }
      onCapture(captured.file); sourceSaved = true;
      setPhase('finishing'); setProgress(0);
      try { await saveCapturedAudio(captured.file); await activeJournal.clear(); recoveryId.current = null; }
      catch {if(mounted.current&&attempt===generation.current)setError('Не удалось сохранить исходник в браузере. Скачайте запись вручную.');}
      if (!mounted.current || attempt !== generation.current) return;
      const controller = new AbortController(); conversion.current = controller;
      const mp3 = await convertToMp3(captured.file, captured.file.name, {
        signal: controller.signal,
        onProgress: value => { if(mounted.current && attempt === generation.current)setProgress(Math.round(value * 100)); },
      });
      if (mounted.current && attempt === generation.current) {
        setFile(mp3);onCapture(mp3);
        try {await saveCapturedAudio(mp3);if(mounted.current&&attempt===generation.current)setSavedMessage('MP3 сохранён в браузере. Если скачивание заблокировано, нажмите кнопку ниже.');}
        catch {if(mounted.current&&attempt===generation.current)setError('Не удалось сохранить MP3 в браузере. Скачайте файл кнопкой ниже.');}
        if (mounted.current && attempt === generation.current) downloadFile(mp3,mp3.name);
      }
    } catch (cause) {
      if (!mounted.current || attempt !== generation.current) return;
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Доступ к вкладке не предоставлен. Можно выбрать её повторно или загрузить готовый аудиофайл.'
        : `${cause instanceof Error ? cause.message : 'Не удалось записать звук вкладки.'}${sourceSaved ? ' Исходная запись WebM прикреплена и доступна для скачивания.' : ''}`);
    } finally {
      cancelledAttempts.current.delete(attempt);
      if (mounted.current && attempt === generation.current) { current.current = null; conversion.current = null; setPhase('idle'); onActiveChange(false); }
    }
  }

  function cancel(): void {
    cancelledAttempts.current.add(generation.current);
    generation.current++;
    const recording = current.current, activeJournal = journal.current;
    recording?.cancel(); current.current = null; conversion.current?.abort(); conversion.current = null;
    if (recording && activeJournal) {
      void recording.result.catch(() => undefined).then(() => activeJournal.clear()).catch(() => {
        if (mounted.current) setError('Не удалось удалить отменённую запись из браузера.');
      });
    }
    if(phase === 'finishing')setError('Подготовка MP3 отменена. Исходная запись WebM доступна для скачивания.');
    setPhase('idle'); onActiveChange(false);
  }

  async function attachRecovered(): Promise<void> {
    if (!file || active) return;
    const recoveredSession = recoveryId.current;
    onCapture(file); setRestored(false); setUnfinished(false); setSavedMessage('Восстановленная запись прикреплена к статье.');
    try {
      await saveCapturedAudio(file);
      if (recoveredSession) await clearCaptureJournal(recoveredSession);
      if (recoveryId.current === recoveredSession) recoveryId.current = null;
    } catch {
      if (mounted.current) setError('Фрагмент прикреплён, но сохранить его в браузере не удалось. Скачайте файл вручную.');
    }
  }

  return <section className="capture-panel" aria-label="Запись звука вкладки">
    <strong>Или запишите звук вкладки</strong>
    <p className="small-note">Chrome/Edge на компьютере. Выберите вкладку с озвучкой, включите передачу её звука и запустите воспроизведение. Микрофон не используется.</p>
    <div className="capture-actions">
      {!active ? <button type="button" className="upload-button" onClick={() => void start()}>Записать звук вкладки</button> : <>
        <span role="status" className="capture-time">{phase === 'requesting' ? 'Выберите вкладку в окне браузера…' : phase === 'finishing' ? `Подготавливаем MP3 · ${progress}%` : `Запись · ${formatTime(seconds)}`}</span>
        {phase === 'recording' && <button type="button" className="upload-button" onClick={() => { setPhase('finishing'); current.current?.stop(); }}>Остановить и прикрепить</button>}
        <button type="button" className="capture-cancel" onClick={cancel}>{phase === 'finishing' ? 'Отменить подготовку MP3' : 'Отменить запись'}</button>
      </>}
    </div>
    {download && <div className="capture-result"><p role="status">{restored ? unfinished ? 'Найдена незавершённая запись. Сохранённый фрагмент можно прослушать, прикрепить или скачать.' : 'Найдена последняя запись в браузере.' : savedMessage || 'Запись прикреплена к статье.'}</p><audio controls src={download.url} preload="metadata" aria-label="Прослушать записанный звук"/>{restored&&<button type="button" className="upload-button" disabled={active} onClick={() => void attachRecovered()}>{unfinished ? 'Прикрепить сохранённый фрагмент' : 'Прикрепить последнюю запись'}</button>}<a className="upload-button" href={download.url} download={download.file.name}>{download.file.type === 'audio/mpeg' ? 'Скачать запись MP3' : 'Скачать исходник WebM'}</a></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
