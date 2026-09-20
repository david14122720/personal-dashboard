import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

// Stitch display face (Control Deck login + habits only). Loaded via
// next/font so it is self-hosted; `--font-deck-display` in globals.css
// carries the fallback stack when the font files are unavailable.
const deckDisplay = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-deck-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Panel Personal",
  description: "Centro de control personal privado: finanzas, hábitos, metas y notas.",
};

const FOUC_GUARD = `(function(){try{var t=localStorage.getItem("dashboard-theme");if(t==="light"){document.documentElement.classList.add("light");}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} ${mono.variable} ${deckDisplay.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FOUC_GUARD }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
