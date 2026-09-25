import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'R1 Tires — Noliktava',
  description: 'Riepu glabāšanas uzskaite un noliktavas uzdevumi',
};

export const viewport: Viewport = { themeColor: '#1a1e29' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="lv">
      <body>{children}</body>
    </html>
  );
}
