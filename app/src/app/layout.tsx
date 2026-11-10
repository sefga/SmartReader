import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { APP_STYLES } from '../lib/reader-styles';

const inter = localFont({src:'../../inter-font.woff2',display:'swap',variable:'--font-inter',weight:'100 900'});

export const metadata: Metadata = {
  title: 'speechread — читайте и слушайте',
  description: 'Личная читалка с подсветкой слов, аудио и сохранением прогресса.',
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/icon.svg` },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className={inter.variable}><head><style id="speechread-styles">{APP_STYLES}</style></head><body>{children}</body></html>;
}
