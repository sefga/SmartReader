export function parseMaterialFiles(files: readonly File[]): { text?: File; audio?: File } {
  const result: { text?: File; audio?: File } = {};
  for (const file of files) {
    if (!file.size) throw new Error(`Файл «${file.name}» пустой.`);
    const text = /\.(txt|md|markdown)$/iu.test(file.name);
    const audio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|oga|opus|webm|weba|aac|flac|mp4|aiff?)$/iu.test(file.name);
    if (text) {
      if (result.text) throw new Error('Добавляйте один текстовый файл за раз.');
      if (file.size > 2_000_000) throw new Error('Текст слишком большой. Максимум 2 МБ.');
      result.text = file;
    } else if (audio) {
      if (result.audio) throw new Error('Добавляйте один аудиофайл за раз.');
      if (file.size > 150_000_000) throw new Error('Выберите аудиофайл меньше 150 МБ.');
      result.audio = file;
    } else {
      throw new Error('Выберите TXT, Markdown или аудиофайл: MP3, WAV, M4A, OGG, WebM.');
    }
  }
  return result;
}
