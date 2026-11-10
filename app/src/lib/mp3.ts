export interface Mp3Options {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

let encoderRegistered = false;

export async function convertToMp3(source: Blob, name: string, { signal, onProgress }: Mp3Options = {}): Promise<File> {
  signal?.throwIfAborted();
  if (!source.size || source.size > 150_000_000) throw new Error('Для MP3 нужен аудиофайл размером от 1 байта до 150 МБ.');
  const [media, encoder] = await Promise.all([import('mediabunny'), import('@mediabunny/mp3-encoder')]);
  signal?.throwIfAborted();
  if (!encoderRegistered) { encoder.registerMp3Encoder(); encoderRegistered = true; }
  const fileName = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').replace(/\.[^.]*$/u, '').slice(0, 140) || 'запись'}.mp3`;
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
