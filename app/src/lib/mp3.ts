export interface Mp3Options {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

let encoderRegistered = false;

function mp3FileName(name: string): string {
  return `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').replace(/\.[^.]*$/u, '').slice(0, 140) || 'запись'}.mp3`;
}

export async function convertToMp3(source: Blob, name: string, { signal, onProgress }: Mp3Options = {}): Promise<File> {
  signal?.throwIfAborted();
  if (!source.size || source.size > 150_000_000) throw new Error('Для MP3 нужен аудиофайл размером от 1 байта до 150 МБ.');
  const [media, encoder] = await Promise.all([import('mediabunny'), import('@mediabunny/mp3-encoder')]);
  signal?.throwIfAborted();
  if (!encoderRegistered) { encoder.registerMp3Encoder(); encoderRegistered = true; }
  const fileName = mp3FileName(name);
  const input = new media.Input({ source: new media.BlobSource(source), formats: media.ALL_FORMATS });
  let conversion: Awaited<ReturnType<typeof media.Conversion.init>> | undefined;
  let limitExceeded = false;
  const cancel = (): void => { void conversion?.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('В файле не найдена звуковая дорожка.');
    signal?.throwIfAborted();
    if (await input.getFormat() === media.MP3) {
      onProgress?.(1);
      return new File([source], fileName, { type: 'audio/mpeg' });
    }
    const target = new media.BufferTarget();
    target.on('write', ({ end }) => { if (end > 150_000_000) { limitExceeded = true; cancel(); } });
    const output = new media.Output({ format: new media.Mp3OutputFormat(), target });
    conversion = await media.Conversion.init({
      input, output, tracks: 'primary', video: { discard: true },
      audio: { codec: 'mp3', quality: new media.Quality({ bitrate: 128_000 }) },
    });
    signal?.throwIfAborted();
    if (!conversion.isValid) throw new Error('Браузер не смог декодировать аудио. Попробуйте актуальный Chrome или Edge.');
    conversion.onProgress = progress => onProgress?.(Math.min(1, Math.max(0, progress)));
    await conversion.execute();
    signal?.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error('Не удалось создать MP3. Исходная запись сохранена.');
    return new File([target.buffer], fileName, { type: 'audio/mpeg' });
  } catch (cause) {
    signal?.throwIfAborted();
    if (limitExceeded) throw new Error('MP3 превысил 150 МБ. Сохраните исходник и разделите запись на части.');
    throw cause;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await conversion?.cancel().catch(() => undefined);
    input.dispose();
  }
}
import { validateSilences, type AudioRange } from './silence.ts';


export async function removeSilenceToMp3(source: Blob, name: string, ranges: AudioRange[], duration: number, { signal, onProgress }: Mp3Options = {}): Promise<File> {
  signal?.throwIfAborted();
  const cuts = validateSilences(ranges, duration);
  if (!cuts.length) return convertToMp3(source, name, { signal, onProgress });
  if (!source.size || source.size > 150_000_000) throw new Error('Для MP3 нужен аудиофайл размером от 1 байта до 150 МБ.');
  const [media, encoder] = await Promise.all([import('mediabunny'), import('@mediabunny/mp3-encoder')]);
  signal?.throwIfAborted();
  if (!encoderRegistered) {encoder.registerMp3Encoder();encoderRegistered = true;}
  const input = new media.Input({ source: new media.BlobSource(source), formats: media.ALL_FORMATS });
  const target = new media.BufferTarget();
  const output = new media.Output({ format: new media.Mp3OutputFormat(), target });
  let conversion: Awaited<ReturnType<typeof media.Conversion.init>> | undefined;
  let cutIndex = 0, writtenFrames = 0, sampleRate = 0, limitExceeded = false;
  const cancel = (): void => { void conversion?.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    target.on('write', ({ end }) => {if (end > 150_000_000) {limitExceeded = true;cancel();}});
    conversion = await media.Conversion.init({
      input, output, tracks: 'primary', video: { discard: true },
      audio: {
        codec: 'mp3', quality: new media.Quality({ bitrate: 128_000 }), forceTranscode: true,
        process: sample => {
          signal?.throwIfAborted();
          if (sampleRate && sampleRate !== sample.sampleRate) throw new Error('Частота дискретизации меняется внутри записи.');
          sampleRate = sample.sampleRate;
          const start = sample.timestamp, end = start + sample.duration;
          while (cutIndex < cuts.length && cuts[cutIndex].end <= start) cutIndex++;
          const kept: { start: number; end: number }[] = [];
          let cursor = start, index = cutIndex;
          while (index < cuts.length && cuts[index].start < end) {
            if (cuts[index].start > cursor) kept.push({start:cursor,end:Math.min(end,cuts[index].start)});
            cursor = Math.max(cursor,cuts[index].end);index++;
          }
          if (cursor < end) kept.push({start:cursor,end});
          return kept.flatMap(part => {
            const from = Math.max(0,Math.ceil((part.start - start) * sample.sampleRate - 1e-7));
            const to = Math.min(sample.numberOfFrames,Math.floor((part.end - start) * sample.sampleRate + 1e-7));
            if (to <= from) return [];
            const trimmed = sample.trim(from,to);
            trimmed.setTimestamp(writtenFrames / sample.sampleRate);
            writtenFrames += trimmed.numberOfFrames;
            return [trimmed];
          });
        },
      },
    });
    signal?.throwIfAborted();
    if (!conversion.isValid) throw new Error('Браузер не смог обработать аудио. Попробуйте актуальный Chrome или Edge.');
    conversion.onProgress = value => onProgress?.(Math.min(1, Math.max(0, value)));
    await conversion.execute();
    signal?.throwIfAborted();
    if (!target.buffer?.byteLength || !writtenFrames) throw new Error('После удаления пауз не осталось аудио. Исходная запись сохранена.');
    return new File([target.buffer],mp3FileName(name),{type:'audio/mpeg'});
  } catch (cause) {
    signal?.throwIfAborted();
    if (limitExceeded) throw new Error('MP3 превысил 150 МБ. Сохраните исходник и разделите запись на части.');
    throw cause;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await conversion?.cancel().catch(() => undefined);
    input.dispose();
  }
}
