import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Inter_Tight } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-fraunces", display: "swap" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-mono", display: "swap" });
const inter = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter-tight", display: "swap" });

export const metadata: Metadata = {
  title: "Covered: pay a stranger's bill, straight to the biller",
  description: "Cover someone's real bill. The money goes to the biller, never to the person.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F2EDE3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plex.variable} ${inter.variable}`}>
      <body>
        <div className="app">
          <header className="hdr">
            <Link href="/" className="logo">Covered<i>.</i></Link>
            <Link href="/how-it-works" className="mono" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--mute)", minHeight: 44, display: "flex", alignItems: "center" }}>
              How it works
            </Link>
          </header>
          <main>{children}</main>
        </div>
        <Nav />
      </body>
    </html>
  );
}
