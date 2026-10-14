import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-nunito" });

export const metadata: Metadata = {
  title: "Sip",
  description: "Reminds you to drink water and tracks your glasses.",
  appleWebApp: { capable: true, title: "Sip", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#140a2e" },
    { media: "(prefers-color-scheme: light)", color: "#eaf4ff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>{children}</body>
    </html>
  );
}
