import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cadence | Communication companion",
  description: "A real-time communication aid for faster, more personal conversations.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try { var saved = localStorage.getItem('cadence.theme'); var theme = saved === 'light' || saved === 'dark' ? saved : 'light'; document.documentElement.classList.toggle('dark', theme === 'dark'); } catch (_) {}" }} /></head>
      <body suppressHydrationWarning>{children}<Analytics /></body>
    </html>
  );
}
