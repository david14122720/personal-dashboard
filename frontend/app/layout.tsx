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
// `preload: false` is deliberate: the class `font-deck-display` is applied
// ONLY on `/login/` and the habits surfaces, but a font declared in the ROOT
// layout with the default `preload: true` emits a `<link rel="preload">` on
// every route, so the browser downloaded Plus Jakarta Sans on pages that never
// render it. Measured on a cold `/dashboard/` load: that was 27.6 KB of the
// 538.9 KB transferred (6 preloaded woff2 files, one of them unused). With
// preload off the @font-face stays in the CSS and the file is fetched on demand
// wherever the class is actually used, so login/habits keep the real face.
const deckDisplay = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-deck-display",
  display: "swap",
  preload: false,
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
        {/* Official Control Deck favicon (vector, Hex Cyber-Deck). Explicit
            link because the `app/favicon` convention only accepts .ico. */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <script dangerouslySetInnerHTML={{ __html: FOUC_GUARD }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
