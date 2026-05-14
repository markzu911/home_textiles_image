import type {Metadata} from 'next';
import { Inter, Cormorant_Garamond } from 'next/font/google';
import './globals.css'; // Global styles

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: '家纺电商生图系统 | Home Textile AI Studio',
  description: 'AI-powered home textile image generation for e-commerce',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${cormorant.variable}`} suppressHydrationWarning>
      <body className="font-sans bg-[#f5f2ed] text-[#1a1a1a] antialiased min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}
