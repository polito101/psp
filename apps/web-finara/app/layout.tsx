import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-sans"
});

export const metadata: Metadata = {
  title: 'Finara | Modern Payment Service Provider',
  description: 'Finara is a modern PSP that helps users and businesses manage, move, and grow their money with simplicity and security.',
  keywords: ['PSP', 'payment service provider', 'fintech', 'payments', 'financial management', 'secure transactions'],
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
  openGraph: {
    title: 'Finara | Modern Payment Service Provider',
    description: 'Manage, move, and grow your money with simplicity and security.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#09090f',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} bg-[#09090f]`}>
      <body className="font-sans antialiased bg-background">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
