'use client';
import { useEffect, useState } from 'react';
import Auth from '../components/Auth';
import Reader from '../components/Reader';
export default function Home() {
  const [library, setLibrary] = useState(false);
  useEffect(()=>setLibrary(window.location.pathname.startsWith('/reader/library/')),[]);
  return library ? <Reader/> : <Auth mode="sign-up"/>;
}
