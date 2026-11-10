import { parseText, validateCues, type ReadingDocument } from './sync.ts';
import { validateSilences, type AudioRange } from './silence.ts';

const AUDIO_PLACEHOLDER = '__SPEECHREAD_EMBEDDED_AUDIO__';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function publicationAudioName(original = ''): string {
  const extension = original.split('.').pop()?.toLowerCase();
  return `article-audio.${extension && /^(mp3|wav|m4a|ogg|oga|opus|webm|aac|flac|mp4|aiff?)$/u.test(extension) ? extension : 'bin'}`;
}

export function createEmbedCode(address: string): string {
  let url: URL;
  try { url = new URL(address.trim()); }
  catch { throw new Error('Укажите полный адрес загруженной страницы, например https://site.ru/audio/article.html.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Нужна публичная ссылка http:// или https:// без логина и пароля.');
  }
  return `<iframe src="${escapeHtml(url.href)}" title="Статья с озвучкой" width="100%" height="720" style="border:0;border-radius:16px" loading="lazy"></iframe>`;
}

export function createPublication(document: ReadingDocument, exact: boolean, options: { embedded?: boolean; silences?: AudioRange[] } = {}): string {
  const { blocks, words } = parseText(document.text);
  const cues = validateCues(document.cues, words, document.duration);
  const title = escapeHtml(document.title);
  const navigation = blocks.map((block, index) => block.kind === 'heading' ? `<a href="#section-${index}">${escapeHtml(block.text)}</a>` : '').join('');
  const article = blocks.map((block, index) => {
    const tag = block.kind === 'heading' ? 'h2' : 'p';
    const content = words.slice(block.first, block.first + block.count).map((word, offset) => `<button class="word" data-word="${block.first + offset}">${escapeHtml(word)}</button>`).join(' ');
    return `<${tag} id="section-${index}">${content}</${tag}>`;
  }).join('\n');
  const timing = JSON.stringify(cues.map(({ start, end }) => ({ start, end })));
  const silences = JSON.stringify(validateSilences(options.silences ?? [],document.duration));
  const audioSource = options.embedded ? `data:audio/mpeg;base64,${AUDIO_PLACEHOLDER}` : `./${publicationAudioName(document.audioName)}`;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f9faf9;color:#1a222c;font:18px/1.75 system-ui,sans-serif;padding:24px 24px 220px}main{max-width:760px;margin:auto}h1{font-size:clamp(30px,5vw,48px);line-height:1.15;letter-spacing:-1px;text-wrap:balance}h2{line-height:1.4;margin-top:40px;scroll-margin-top:24px}p{margin:0 0 24px}.word{display:inline;border:0;background:none;color:inherit;padding:1px 0;font:inherit;cursor:pointer;border-radius:3px;text-align:left}.word:hover{background:#e9eeeb}.word[aria-current=true]{background:#b8f08b;box-shadow:3px 0 #b8f08b,-3px 0 #b8f08b}a{color:#286a47}nav{display:flex;gap:12px;overflow:auto;margin:20px 0 30px;padding:8px 0;font-size:14px}nav a{white-space:nowrap}.note{color:#63706a;font-size:13px}footer{position:fixed;bottom:16px;left:16px;right:16px;background:white;border:1px solid #e5e9e6;box-shadow:0 8px 40px #1a222c18;border-radius:16px;padding:16px;max-width:900px;margin:auto}audio{width:100%;display:block}.options{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:13px;margin-bottom:10px}.options label{display:flex;align-items:center;gap:6px;min-height:40px}select{font:inherit;padding:8px;border:1px solid #dce3de;border-radius:8px}#message{margin:6px 0 0;color:#963c2e;font-size:13px}progress{width:100%;height:4px;accent-color:#4ba571}:focus-visible{outline:2px solid #258b55;outline-offset:3px}@media(max-width:500px){body{font-size:17px;padding:16px 20px 230px}footer{left:8px;right:8px;bottom:8px;padding:12px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><main><p class="note">speechread</p><h1>${title}</h1>
<p class="note">${exact ? 'Точные метки слов из JSON' : document.alignment ? 'Автоматическая синхронизация: возможны неточности.' : 'Приблизительная подсветка: паузы и интонация могут смещать выделение.'} · Нажмите на слово для перехода в аудио.</p>
<nav aria-label="Разделы статьи">${navigation}</nav><article aria-label="Текст статьи">${article}</article></main>
<footer aria-label="Аудиоплеер"><div class="options"><label>Скорость <select id="speed" aria-label="Скорость воспроизведения">${[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => `<option value="${rate}"${rate === 1 ? ' selected' : ''}>${rate}×</option>`).join('')}</select></label><label><input id="follow" type="checkbox" checked>Следить за текстом</label>${options.silences?.length ? '<label><input id="skip-silence" type="checkbox">Пропускать паузы</label>' : ''}</div>
<audio id="audio" controls preload="metadata" src="${audioSource}"></audio><progress id="progress" max="100" value="0" aria-label="Прогресс прослушивания"></progress><p id="message" role="status"></p></footer>
<script>
const cues=${timing};
const silences=${silences};
const audio=document.getElementById('audio');
const elements=document.querySelectorAll('[data-word]');
const message=document.getElementById('message');
let active=-1;
function update(){
  if(!audio.paused&&document.getElementById('skip-silence')?.checked){const gap=silences.find(item=>audio.currentTime>=item.start&&audio.currentTime<item.end);if(gap)audio.currentTime=gap.end;}
  let low=0,high=cues.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(cues[mid].start<=audio.currentTime)low=mid;else high=mid-1;}
  const next=cues[low]&&audio.currentTime>=cues[low].start&&audio.currentTime<cues[low].end?low:-1;
  if(next!==active){
    elements[active]?.removeAttribute('aria-current');active=next;
    const word=elements[active];word?.setAttribute('aria-current','true');
    if(word&&!audio.paused&&document.getElementById('follow').checked){const rect=word.getBoundingClientRect();if(rect.top<30||rect.bottom>innerHeight-210)word.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
  }
  document.getElementById('progress').value=Number.isFinite(audio.duration)&&audio.duration>0?audio.currentTime/audio.duration*100:0;
}
document.querySelector('article').addEventListener('click',event=>{const word=event.target.closest('[data-word]');if(!word)return;try{audio.currentTime=cues[Number(word.dataset.word)].start;update();}catch{message.textContent='Дождитесь загрузки аудио и повторите.';}});
document.getElementById('speed').addEventListener('change',event=>{audio.playbackRate=Number(event.target.value);});
let animationFrame=0;
function followAudio(){if(audio.paused)return;update();animationFrame=requestAnimationFrame(followAudio);}
audio.addEventListener('play',()=>{cancelAnimationFrame(animationFrame);animationFrame=requestAnimationFrame(followAudio);});
audio.addEventListener('pause',()=>cancelAnimationFrame(animationFrame));
audio.addEventListener('timeupdate',update);audio.addEventListener('seeked',update);
audio.addEventListener('error',()=>{message.textContent=${JSON.stringify(options.embedded ? 'Не удалось воспроизвести встроенное аудио.' : `Аудио не найдено или не поддерживается. Поместите файл ${publicationAudioName(document.audioName)} рядом с article.html.`)};});
</script></body></html>`;
}

export async function createStandalonePublication(document: ReadingDocument, exact: boolean, audio: Blob, options: { silences?: AudioRange[]; signal?: AbortSignal; onProgress?: (value: number) => void } = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  if (!audio.size || audio.type !== 'audio/mpeg') throw new Error('Для встроенной страницы нужен готовый MP3.');
  const template = createPublication(document,exact,{embedded:true,silences:options.silences});
  const marker = `src="data:audio/mpeg;base64,${AUDIO_PLACEHOLDER}"`;
  const index = template.indexOf(marker);
  if (index < 0) throw new Error('Не удалось подготовить страницу.');
  const start = index + marker.indexOf(AUDIO_PLACEHOLDER);
  const chunks: BlobPart[] = [template.slice(0,start)];
  const chunkSize = 3 * 65_536;
  for (let offset = 0; offset < audio.size; offset += chunkSize) {
    options.signal?.throwIfAborted();
    const bytes = new Uint8Array(await audio.slice(offset,offset + chunkSize).arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index,index + 8192));
    chunks.push(btoa(binary));
    options.onProgress?.(Math.min(1,(offset + bytes.length) / audio.size));
  }
  options.signal?.throwIfAborted();
  chunks.push(template.slice(start + AUDIO_PLACEHOLDER.length));
  return new Blob(chunks,{type:'text/html;charset=utf-8'});
}
