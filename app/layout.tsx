import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Freight Quoting Portal',
  description: 'Get instant shipping quotes using natural language',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
