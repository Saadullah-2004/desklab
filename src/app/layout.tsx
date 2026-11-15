import type {Metadata} from 'next';
import {appOrigin} from '@/lib/server-config';
import {pageMetadata} from './_metadata';
import './globals.css';
export const metadata: Metadata = {
  ...pageMetadata('/'),
  metadataBase: new URL(appOrigin() ?? 'http://localhost:3000'),
  applicationName: 'DeskLab',
};
export default function RootLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
