import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

// Self-hosted at build time: no request to Google from the browser.
const sans = IBM_Plex_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], variable: '--font-plex-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600'], variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'R1 Tires — Noliktava',
  description: 'Riepu glabāšanas uzskaite un noliktavas uzdevumi',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'R1 Noliktava', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#1a1e29', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="lv" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {children}
        {/* The printable handover act and manual render here; printing swaps the page for it. */}
        <div id="print-area" aria-hidden="true" />
      </body>
    </html>
  );
}
