import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const inter = localFont({src:'../../inter-font.woff2',display:'swap',variable:'--font-inter',weight:'100 900'});

export const metadata: Metadata = {
  title: 'SmartReader — читайте и слушайте',
  description: 'Личная читалка с подсветкой слов, аудио и сохранением прогресса.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className={inter.variable}><body>{children}</body></html>;
}
