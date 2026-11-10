import { parseText, validateCues, type ReadingDocument } from './sync.ts';
import { validateSilences, type AudioRange } from './silence.ts';
import { PUBLICATION_FONT_URL } from './publication-font.ts';
import { APP_STYLES } from './reader-styles.ts';

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

function publicationStorageKey(document: ReadingDocument): string {
  const signature = `${document.title}\u0000${document.text}\u0000${document.duration}`;
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index++) hash = Math.imul(hash ^ signature.charCodeAt(index), 16777619);
  return `speechread-publication:${(hash >>> 0).toString(16)}:${signature.length}`;
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}

// Этот код выполняется непосредственно в автономном HTML: без модулей, SDK и зависимостей приложения.
const PORTABLE_PLAYER = String.raw`
const byId=id=>document.getElementById(id);
const audio=byId('audio'),article=byId('article'),message=byId('message');
const elements=Array.from(document.querySelectorAll('[data-word]'));
const headings=Array.from(document.querySelectorAll('[data-section]'));
const sectionLinks=Array.from(document.querySelectorAll('[data-section-link]'));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const format=value=>{const seconds=Math.max(0,Math.floor(finite(value,0)));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');};
let state={position:data.position,rate:1,fontSize:window.innerWidth<=760?17:22,follow:false,skip:false,bookmark:null,collapsed:true,activated:false};
try{
  const saved=JSON.parse(localStorage.getItem(data.storageKey)||'null');
  if(saved&&typeof saved==='object'){
    state.position=clamp(finite(saved.position,data.position),0,data.duration);
    state.rate=[0.5,0.75,1,1.25,1.5,1.75,2].includes(saved.rate)?saved.rate:1;
    state.fontSize=clamp(finite(saved.fontSize,state.fontSize),16,30);
    state.bookmark=typeof saved.bookmark==='number'&&Number.isFinite(saved.bookmark)?clamp(saved.bookmark,0,data.duration):null;
    for(const key of ['follow','skip'])if(typeof saved[key]==='boolean')state[key]=saved[key];
  }
}catch{}
let lastSaved=-1,active=-1,animationFrame=0,metadataReady=audio.readyState>=1;
const duration=()=>Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:data.duration;
function persist(force=false){
  const second=Math.floor(audio.currentTime||0);
  if(!force&&second===lastSaved)return true;
  lastSaved=second;if(metadataReady)state.position=clamp(finite(audio.currentTime,state.position),0,duration());
  try{localStorage.setItem(data.storageKey,JSON.stringify(state));return true;}catch{return false;}
}
function updateReading(){
  const top=article.getBoundingClientRect().top+window.scrollY;
  const percent=clamp(Math.round((window.scrollY-top+150)/Math.max(1,article.offsetHeight-window.innerHeight+230)*100),0,100);
  byId('reading-percent').textContent=percent+'%';byId('reading-line').style.width=percent+'%';
  let section=headings[0]?.dataset.section??'-1';
  for(const heading of headings)if(heading.getBoundingClientRect().top<190)section=heading.dataset.section;
  for(const link of sectionLinks)link.classList.toggle('is-active',link.dataset.sectionLink===section);
}
function updatePlayerVisibility(){
  byId('audio-player-controls').hidden=!state.activated||state.collapsed;byId('mini-player').hidden=!state.activated||!state.collapsed||audio.paused;
  byId('listen').setAttribute('aria-expanded',String(state.activated&&!state.collapsed));
  document.body.classList.toggle('player-collapsed',state.activated&&state.collapsed&&!audio.paused);document.body.classList.toggle('reading-only',!state.activated||(state.collapsed&&audio.paused));
}
function applyOptions(){
  article.style.fontSize=state.fontSize+'px';byId('font-size').value=String(state.fontSize);byId('font-label').textContent=state.fontSize+' px';
  byId('speed').value=String(state.rate);audio.playbackRate=state.rate;
  for(const [id,key] of [['follow','follow'],['skip-silence','skip']]){const button=byId(id);if(button){button.classList.toggle('enabled',state[key]);button.setAttribute('aria-pressed',String(state[key]));}}
  byId('bookmark').classList.toggle('bookmarked',state.bookmark!==null);byId('bookmark').setAttribute('aria-pressed',String(state.bookmark!==null));
  byId('return-bookmark').disabled=state.bookmark===null;byId('bookmark-time').textContent=state.bookmark===null?'Нет закладки':format(state.bookmark);
  byId('return-bookmark').hidden=state.bookmark===null;byId('settings-follow-state').textContent=state.follow?'Включена':'Выключена';
  updatePlayerVisibility();updateReading();
}
function update(){
  if(!audio.paused&&state.skip){const gap=data.silences.find(item=>audio.currentTime>=item.start&&audio.currentTime<item.end);if(gap)audio.currentTime=Math.min(duration(),gap.end);}
  const time=clamp(finite(audio.currentTime,0),0,duration());
  let low=0,high=data.cues.length-1;
  while(low<high){const middle=Math.ceil((low+high)/2);if(data.cues[middle].start<=time)low=middle;else high=middle-1;}
  const next=state.follow&&!audio.paused&&data.cues[low]&&time>=data.cues[low].start&&time<data.cues[low].end?low:-1;
  if(next!==active){
    elements[active]?.removeAttribute('aria-current');elements[active]?.classList.toggle('current-word',false);
    active=next;const word=elements[active];word?.setAttribute('aria-current','true');word?.classList.toggle('current-word',true);
    if(word&&!audio.paused&&state.follow){const rect=word.getBoundingClientRect();if(rect.top<160||rect.bottom>window.innerHeight-(state.collapsed?100:230))word.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  }
  const percent=Math.round(time/duration()*100);
  byId('timeline').max=String(duration());byId('timeline').value=String(time);byId('timeline').style.setProperty('--progress',percent+'%');
  byId('current-time').textContent=format(time);byId('duration').textContent=format(duration());byId('audio-percent').textContent=percent+'%';byId('mini-time').textContent=format(time);
  document.body.classList.toggle('is-playing',!audio.paused);
  byId('listen').textContent=audio.paused?'Слушать':'Открыть плеер';updatePlayerVisibility();
  for(const id of ['play','mini-play']){byId(id).setAttribute('aria-label',audio.paused?'Воспроизвести':'Пауза');byId(id).setAttribute('aria-pressed',String(!audio.paused));}
  persist();
}
function seek(time){try{state.position=clamp(time,0,duration());audio.currentTime=state.position;update();persist(true);}catch{message.textContent='Дождитесь загрузки аудио и повторите.';}}
async function togglePlayback(){
  if(!audio.paused){audio.pause();return;}
  if(audio.ended||audio.currentTime>=duration())seek(0);
  try{message.textContent='';await audio.play();}catch{message.textContent='Не удалось запустить аудио. Нажмите «Воспроизвести» ещё раз или проверьте файл.';}
  update();
}
function animate(){if(audio.paused)return;update();animationFrame=requestAnimationFrame(animate);}
async function listen(){state.activated=true;state.collapsed=false;applyOptions();persist(true);if(audio.paused)await togglePlayback();}
for(const id of ['play','mini-play'])byId(id).addEventListener('click',togglePlayback);
byId('listen').addEventListener('click',listen);
byId('listen-follow').addEventListener('click',()=>{state.follow=true;return listen();});
byId('settings-open').addEventListener('click',()=>byId('settings').showModal());
byId('settings-close').addEventListener('click',()=>byId('settings').close());
byId('settings').addEventListener('click',event=>{if(event.target===byId('settings'))byId('settings').close();});
byId('settings-follow').addEventListener('click',()=>{state.follow=!state.follow;applyOptions();update();persist(true);});
byId('back').addEventListener('click',()=>seek(audio.currentTime-15));byId('forward').addEventListener('click',()=>seek(audio.currentTime+15));
byId('timeline').addEventListener('input',event=>seek(Number(event.target.value)));
byId('speed').addEventListener('change',event=>{const rate=Number(event.target.value);if([0.5,0.75,1,1.25,1.5,1.75,2].includes(rate)){audio.pause();state.rate=rate;audio.playbackRate=rate;persist(true);}});
byId('font-size').addEventListener('input',event=>{state.fontSize=clamp(finite(Number(event.target.value),22),16,30);applyOptions();persist(true);});
for(const [id,key] of [['follow','follow'],['skip-silence','skip']])byId(id)?.addEventListener('click',()=>{state[key]=!state[key];applyOptions();update();persist(true);});
byId('collapse-player').addEventListener('click',()=>{state.collapsed=true;applyOptions();persist(true);byId('show-player').focus();});
byId('show-player').addEventListener('click',()=>{state.collapsed=false;applyOptions();persist(true);byId('collapse-player').focus();});
byId('bookmark').addEventListener('click',()=>{state.bookmark=clamp(audio.currentTime,0,duration());applyOptions();message.textContent=persist(true)?'Закладка сохранена: '+format(state.bookmark)+'.':'Закладка доступна до закрытия страницы.';});
byId('return-bookmark').addEventListener('click',()=>{if(state.bookmark!==null){seek(state.bookmark);byId('settings').close();}});
byId('restart').addEventListener('click',()=>{seek(0);window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
article.addEventListener('click',event=>{const word=event.target.closest('[data-word]');const index=Number(word?.dataset.word);if(word&&Number.isInteger(index)&&data.cues[index])seek(data.cues[index].start);});
for(const link of sectionLinks)link.addEventListener('click',()=>{state.follow=false;applyOptions();persist(true);});
window.addEventListener('keydown',event=>{
  if(!state.activated||byId('settings').open||(state.collapsed&&audio.paused)||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.repeat||event.target?.closest?.('input,textarea,select,button,a,summary,[contenteditable=true],[role=textbox],[role=button]'))return;
  if(event.code==='Space'){event.preventDefault();void togglePlayback();}
  else if(event.code==='ArrowLeft'){event.preventDefault();seek(audio.currentTime-15);}
  else if(event.code==='ArrowRight'){event.preventDefault();seek(audio.currentTime+15);}
});
audio.addEventListener('loadedmetadata',()=>{metadataReady=true;seek(state.position);audio.playbackRate=state.rate;});
audio.addEventListener('play',()=>{cancelAnimationFrame(animationFrame);update();animationFrame=requestAnimationFrame(animate);});
for(const name of ['pause','ended'])audio.addEventListener(name,()=>{cancelAnimationFrame(animationFrame);update();persist(true);});
for(const name of ['timeupdate','seeked','durationchange'])audio.addEventListener(name,update);
audio.addEventListener('error',()=>{cancelAnimationFrame(animationFrame);audio.pause();message.textContent=data.audioError;});
window.addEventListener('scroll',updateReading,{passive:true});window.addEventListener('resize',updateReading);
window.addEventListener('pagehide',()=>persist(true));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist(true);});
byId('download-audio').href=audio.src;byId('download-audio').download=data.downloadName;
applyOptions();byId('current-time').textContent=format(state.position);byId('duration').textContent=format(data.duration);byId('mini-time').textContent=format(state.position);
if(metadataReady)seek(state.position);
`;

// Только особенности автономного документа; оформление Reader берётся из APP_STYLES целиком.
const PORTABLE_CSS = `
@font-face{font-family:Inter;src:url("${PUBLICATION_FONT_URL}") format('woff2');font-style:normal;font-weight:100 900;font-display:swap}
:root{--font-inter:Inter}[hidden]{display:none!important}.pause-icon{display:none}.is-playing .play-icon{display:none}.is-playing .pause-icon{display:block}
.play-button .play-icon{margin-left:2px}.play-button .pause-icon{margin-left:0}.audio-mini-player svg{width:18px;height:18px}
#message{grid-column:1/-1;margin-top:4px;font-size:12px;color:#963c2e;overflow-wrap:anywhere}#message:empty{display:none}
`;

function publicationIcon(name: 'book' | 'settings' | 'volume' | 'back' | 'forward' | 'bookmark' | 'close' | 'download', size = 20): string {
  const paths = {
    book: '<path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z"/><path d="M12 5v15"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/>',
    volume: '<path d="m11 4-6 5H2v6h3l6 5V4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-12a11 11 0 0 1 0 16"/>',
    back: '<path d="M9 10 4 5m0 0h5M4 5v5"/><path d="M4.5 5.5a9 9 0 1 1-1 9"/><path d="M10 10v6m3-6h3v3h-3v3h3"/>',
    forward: '<path d="m15 10 5-5m0 0h-5m5 0v5"/><path d="M19.5 5.5a9 9 0 1 0 1 9"/><path d="M8 10v6m3-6h3v3h-3v3h3"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  };
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

export function createPublication(document: ReadingDocument, exact: boolean, options: { embedded?: boolean; silences?: AudioRange[] } = {}): string {
  const { blocks, words } = parseText(document.text);
  const cues = validateCues(document.cues, words, document.duration);
  const silences = validateSilences(options.silences ?? [], document.duration);
  const title = escapeHtml(document.title);
  const navigation = blocks.map((block, index) => block.kind === 'heading' ? `<a href="#section-${index}" data-section-link="${index}">${escapeHtml(block.text)}</a>` : '').join('') || '<a href="#article" data-section-link="-1">Начало статьи</a>';
  const article = blocks.map((block, index) => {
    const tag = block.kind === 'heading' ? 'h2' : 'p';
    const content = words.slice(block.first, block.first + block.count).map((word, offset) => `<button class="read-word" data-word="${block.first + offset}">${escapeHtml(word)}</button>`).join(' ');
    return `<${tag} id="section-${index}"${block.kind === 'heading' ? ` data-section="${index}"` : ''}>${content}</${tag}>`;
  }).join('\n');
  const audioSource = options.embedded ? `data:audio/mpeg;base64,${AUDIO_PLACEHOLDER}` : `./${publicationAudioName(document.audioName)}`;
  const data = safeScriptJson({
    cues: cues.map(({ start, end }) => ({ start, end })), silences, duration: document.duration,
    position: Number.isFinite(document.position) ? Math.max(0, Math.min(document.duration, document.position)) : 0,
    storageKey: publicationStorageKey(document), downloadName: options.embedded ? 'article-audio.mp3' : publicationAudioName(document.audioName),
    audioError: options.embedded ? 'Не удалось воспроизвести встроенное аудио.' : `Аудио не найдено или не поддерживается. Поместите файл ${publicationAudioName(document.audioName)} рядом с article.html.`,
  });
  const note = exact ? 'Метки из JSON. Формат проверен; совпадение со звуком может быть неточным.' : document.alignment?.source === 'gemini' ? 'Оценка Gemini: возможны неточности времени слов.' : document.alignment ? 'Автоматическая синхронизация: возможны неточности.' : 'Приблизительная подсветка: паузы и интонация могут смещать выделение.';
  const timingLabel = exact ? '✓ Метки из JSON' : document.alignment?.source === 'gemini' ? 'Оценка Gemini' : document.alignment?.source === 'openai' ? '✓ OpenAI' : document.alignment ? '✓ Встроенный способ' : '≈ Пока приблизительно';
  const playIcons = '<svg class="play-icon" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m8 4 12 8-12 8V4Z" stroke="none"/></svg><svg class="pause-icon" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  const toggle = '<span class="toggle-track" aria-hidden="true"><span></span></span>';
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title><style>${APP_STYLES}\n${PORTABLE_CSS}</style></head>
<body id="top" class="reader-app reading-only"><header class="reader-topbar"><a class="reader-brand" href="#top" aria-label="speechread — начало статьи">${publicationIcon('book', 24)}<span>speechread</span></a><a id="download-audio" class="upload-button publish-button" href="#audio">${publicationIcon('download', 17)}<span>Скачать аудио</span></a></header>
<nav class="reading-nav" aria-label="Разделы статьи"><span id="reading-percent" class="reading-percent" title="Прогресс чтения">0%</span><div class="section-links">${navigation}</div><div class="reading-line"><span id="reading-line"></span></div></nav>
<main class="reader-main"><div class="article-eyebrow"><span class="live-dot"></span>ВАША СТАТЬЯ<span>ТЕКСТ + АУДИО</span></div>
<div class="article-title-row"><h1>${title}</h1><button id="settings-open" class="icon-button" aria-label="Настройки чтения" aria-haspopup="dialog">${publicationIcon('settings')}</button></div>
<div class="article-meta"><span>${words.length} слов</span><span>·</span><span>${Math.max(1, Math.ceil(document.duration / 60))} мин</span><span>·</span><span>Сохранено на устройстве</span></div>
<div class="reader-callout"><span class="callout-icon">${publicationIcon('volume')}</span><div><strong>Читайте. Слушайте. Следуйте за словами.</strong><p>Читайте без плеера или включите аудио. Слежение за текстом включается отдельно.</p><div class="listening-actions"><button id="listen" class="upload-button" aria-controls="audio-player-controls" aria-expanded="false">Слушать</button><button id="listen-follow" class="text-action">Слушать и следить</button></div></div></div>
<div class="reader-toolbar"><button id="follow" class="follow-toggle" aria-pressed="false">${toggle}Следить за текстом</button>${silences.length ? `<button id="skip-silence" class="follow-toggle" aria-pressed="false">${toggle}Пропускать паузы</button>` : ''}<p class="timing-button" title="${escapeHtml(note)}" aria-label="${escapeHtml(note)}">Синхронизация слов <span aria-hidden="true">ⓘ</span><small>${timingLabel}</small></p></div>
<article id="article" class="reading-article" aria-label="Текст статьи">${article}</article><div class="article-end"><span>Вы дочитали до конца</span><button id="restart">Вернуться к началу ↑</button></div></main>
<dialog id="settings" class="modal" aria-labelledby="settings-title"><div class="modal-heading"><h2 id="settings-title">Настройки чтения</h2><button id="settings-close" class="icon-button" aria-label="Закрыть настройки">${publicationIcon('close')}</button></div><div class="settings-panel"><label for="font-size">Размер текста <strong id="font-label">22 px</strong><input id="font-size" type="range" min="16" max="30" value="22"></label><button id="settings-follow" class="setting-row">Автопрокрутка <span id="settings-follow-state">Выключена</span></button><button id="return-bookmark" class="setting-row" type="button" disabled hidden>Перейти к закладке <span id="bookmark-time">Нет закладки</span></button><p>Пробел — пауза. Стрелки ← и → — перемотка на 15 секунд. Нажмите на слово, чтобы перейти к нему.</p><p>Прогресс и настройки сохраняются в этом браузере, если доступно локальное хранилище.</p></div></dialog>
<footer class="audio-player" id="audio-player-controls" aria-label="Аудиоплеер" hidden><div class="audio-player-inner"><div class="player-track"><span class="track-cover">${publicationIcon('book', 22)}</span><div><strong>${title}</strong><span>${escapeHtml(document.audioName || 'Озвучка статьи')}</span></div></div>
<div class="player-controls"><button id="back" class="skip-button" aria-label="Назад на 15 секунд">${publicationIcon('back', 25)}</button><button id="play" class="play-button" aria-label="Воспроизвести" aria-pressed="false">${playIcons}</button><button id="forward" class="skip-button" aria-label="Вперёд на 15 секунд">${publicationIcon('forward', 25)}</button></div>
<div class="player-options"><label class="speed-select"><span class="sr-only">Скорость воспроизведения</span><select id="speed" aria-label="Скорость воспроизведения">${[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => `<option value="${rate}"${rate === 1 ? ' selected' : ''}>${rate}×</option>`).join('')}</select></label><button id="bookmark" class="icon-button" aria-label="Поставить закладку" aria-pressed="false">${publicationIcon('bookmark')}</button><button id="collapse-player" class="icon-button" aria-label="Свернуть плеер" aria-controls="audio-player-controls" aria-expanded="true">${publicationIcon('close', 18)}</button></div>
<div class="player-timeline"><span id="current-time">0:00</span><input id="timeline" aria-label="Позиция аудио" type="range" min="0" max="${document.duration}" step="0.05" value="0"><span id="duration">0:00</span><span id="audio-percent" class="audio-percent">0%</span></div><p id="message" role="status" aria-live="polite"></p></div></footer>
<div id="mini-player" class="audio-mini-player" role="group" aria-label="Свёрнутый плеер" hidden><button id="mini-play" class="icon-button" aria-label="Воспроизвести" aria-pressed="false">${playIcons}</button><button id="show-player" class="show-player" aria-controls="audio-player-controls" aria-expanded="false">Показать плеер <span id="mini-time">0:00</span></button></div>
<audio id="audio" preload="metadata" src="${audioSource}" hidden></audio><noscript><p>Для плеера и подсветки включите JavaScript. Текст статьи доступен выше.</p></noscript>
<script>const data=${data};\n${PORTABLE_PLAYER}</script></body></html>`;
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
