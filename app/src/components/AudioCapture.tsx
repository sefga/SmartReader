'use client';
import { useEffect, useRef, useState } from 'react';
import { captureTabAudio, type AudioRecording } from '../lib/recording';
import { formatTime } from '../lib/sync';
import { convertToMp3 } from '../lib/mp3';

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
  const current = useRef<AudioRecording | null>(null);
  const conversion = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const active = phase !== 'idle';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; current.current?.cancel(); conversion.current?.abort(); };
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
    setError(''); setSeconds(0); setPhase('requesting'); onActiveChange(true);
    try {
      const recording = await captureTabAudio(value => { if (mounted.current && attempt === generation.current) setSeconds(value); });
      if (!mounted.current || attempt !== generation.current) {
        recording.cancel(); await recording.result.catch(() => undefined); return;
      }
      current.current = recording; setPhase('recording');
      const captured = await recording.result;
      if (!mounted.current || attempt !== generation.current) return;
      setFile(captured.file); onCapture(captured.file); sourceSaved = true;
      if(captured.warning)setError(captured.warning);
      setPhase('finishing'); setProgress(0);
      const controller = new AbortController(); conversion.current = controller;
      const mp3 = await convertToMp3(captured.file, captured.file.name, {
        signal: controller.signal,
        onProgress: value => { if(mounted.current && attempt === generation.current)setProgress(Math.round(value * 100)); },
      });
      if (mounted.current && attempt === generation.current) { setFile(mp3); onCapture(mp3); }
    } catch (cause) {
      if (!mounted.current || attempt !== generation.current) return;
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Доступ к вкладке не предоставлен. Можно выбрать её повторно или загрузить готовый аудиофайл.'
        : `${cause instanceof Error ? cause.message : 'Не удалось записать звук вкладки.'}${sourceSaved ? ' Исходная запись WebM прикреплена и доступна для скачивания.' : ''}`);
    } finally {
      if (mounted.current && attempt === generation.current) { current.current = null; conversion.current = null; setPhase('idle'); onActiveChange(false); }
    }
  }

  function cancel(): void {
    generation.current++; current.current?.cancel(); current.current = null; conversion.current?.abort(); conversion.current = null;
    if(phase === 'finishing')setError('Подготовка MP3 отменена. Исходная запись WebM доступна для скачивания.');
    setPhase('idle'); onActiveChange(false);
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
    {download && <div className="capture-result"><p role="status">Последняя запись прикреплена к статье. Её можно прослушать и скачать.</p><audio controls src={download.url} preload="metadata" aria-label="Прослушать записанный звук"/><a className="upload-button" href={download.url} download={download.file.name}>{download.file.type === 'audio/mpeg' ? 'Скачать запись MP3' : 'Скачать исходник WebM'}</a></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
