import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { QueryProvider } from "@/components/providers/query-provider";
import { readLayoutSessionFromCookies } from "@/lib/server/read-layout-session";

const inter = Inter({
  variable: "--font-sans-app",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PSP Backoffice",
  description: "Frontend administrativo para monitoreo operativo PSP",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await readLayoutSessionFromCookies();
  return (
    <html lang="es" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50 font-sans text-slate-900">
        <QueryProvider>
          <AppShell session={session}>{children}</AppShell>
        </QueryProvider>
      </body>
    </html>
  );
}
