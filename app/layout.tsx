import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cadence | Communication companion",
  description: "A real-time communication aid for faster, more personal conversations.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
