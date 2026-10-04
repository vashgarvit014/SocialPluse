import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SocialPulse Superadmin',
  description: 'SocialPulse Superadmin console',
  robots: { index: false, follow: false },
};

// Minimal root layout — the real shell/fonts/theme live in
// src/app/superadmin/layout.tsx. This app serves exactly one surface, so
// there is nothing else to branch on at this level.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
