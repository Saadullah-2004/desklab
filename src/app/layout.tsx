import type {Metadata} from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'DeskLab | Make room for your best work',
  description:
    'Thoughtful tools. A space that feels like you. Build a workspace around your space, style and budget.',
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
