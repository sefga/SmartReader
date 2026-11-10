'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Reader from '../components/Reader';

export default function NotFound() {
  const [library, setLibrary] = useState(false);
  useEffect(()=>setLibrary(window.location.pathname.startsWith(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/reader/library/`)),[]);
  if(library) return <Reader/>;
  return <main className="auth-main"><div className="auth-card"><h1>Страница не найдена</h1><p style={{margin:'20px 0'}}>Перейдите в читалку, чтобы открыть свой материал.</p><Link className="primary-button" href="/">Открыть читалку</Link></div></main>;
}
