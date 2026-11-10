import type { CSSProperties } from 'react';

export type IconName = 'play' | 'pause' | 'back' | 'forward' | 'upload' | 'book' | 'close' | 'check' | 'arrow' | 'settings' | 'bookmark' | 'menu' | 'volume';
const paths: Record<Exclude<IconName, 'play' | 'pause'>, React.ReactNode> = {
  back: <><path d="M9 10 4 5m0 0h5M4 5v5"/><path d="M4.5 5.5a9 9 0 1 1-1 9"/><path d="M10 10v6m3-6h3v3h-3v3h3"/></>,
  forward: <><path d="m15 10 5-5m0 0h-5m5 0v5"/><path d="M19.5 5.5a9 9 0 1 0 1 9"/><path d="M8 10v6m3-6h3v3h-3v3h3"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
  book: <><path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z"/><path d="M12 5v15"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z"/>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5V4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-12a11 11 0 0 1 0 16"/></>,
};

export default function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' || name === 'pause' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={style}>
    {name === 'play' ? <path d="m8 4 12 8-12 8V4Z" stroke="none"/> : name === 'pause' ? <><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></> : paths[name]}
  </svg>;
}
