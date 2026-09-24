import type { Metadata } from "next";
import { Cormorant_Garamond, Inter, IBM_Plex_Sans_Thai } from "next/font/google";
import { LanguageProvider } from "./i18n/LanguageContext";
import { NavProvider } from "./context/NavContext";
import { AuthProvider } from "./context/AuthContext";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TITLE,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
} from "./lib/site";
import "./globals.css";
import GlobalAdminBell from "./components/GlobalAdminBell";
import MaintenanceOverlay from "./components/MaintenanceOverlay";
import { isMaintenanceMode } from "./lib/settingsStore";
import MaintenanceBanner from "./components/MaintenanceBanner";

const cormorant = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Not preloaded. Five weights × two subsets made this ten of the twelve font
// files every page fetched at high priority (~108 KB), ahead of the hero
// image — yet a page only ever needs the few whose weight and character range
// it actually renders (Thai glyphs in h1–h6 fall back to it from Cormorant,
// see globals.css; the Navbar menu uses it directly). Without the preload the
// @font-face rules are unchanged, so the browser fetches exactly those files
// on demand; text shows in the size-adjusted fallback until they arrive
// (display: swap and adjustFontFallback are next/font's defaults).
//
// Every weight is kept on purpose: headings across the site render Thai at
// 300–700, and dropping one would make the browser fake it instead.
const ibmPlexThai = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  // NOTE: no site-wide `alternates.canonical` here — a hardcoded "/" in the root
  // layout makes every page that forgets its own canonical self-canonicalize to
  // the homepage (that footgun already dropped /catalog from the index). Each
  // page sets its own canonical instead; the homepage's lives in app/page.tsx.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "th_TH",
    alternateLocale: ["en_US", "zh_CN"],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    telephone: false,
  },
  verification: {
    // Google Search Console site-verification token. It's a PUBLIC value (it
    // ships as a <meta> tag in the HTML anyway), so the literal stays here as a
    // safe fallback — the tag renders on prod even if the Vercel env var isn't
    // set. GOOGLE_SITE_VERIFICATION (in .env.local / Vercel) overrides it.
    google:
      process.env.GOOGLE_SITE_VERIFICATION ||
      "n4kf-TMDU4HxMTos40MVd7_QKfjknNKqS5oDBwhWHdY",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read here rather than fetched in the overlay on mount, so the maintenance
  // screen is part of the delivered HTML instead of appearing a round trip
  // later. The read is cached and tag-busted by the toggle (settingsStore.ts),
  // and it touches no dynamic API, so it does not force any page out of static
  // or ISR rendering — the toggle calls revalidatePath for the two prerendered
  // paths that would otherwise hold a stale copy.
  const maintenanceOn = await isMaintenanceMode();

  return (
    <html
      lang="th"
      className={`${cormorant.variable} ${inter.variable} ${ibmPlexThai.variable} antialiased`}
    >
      <body className="min-h-screen flex flex-col font-sans">
        <LanguageProvider>
          <AuthProvider>
            <NavProvider>{children}</NavProvider>
            <GlobalAdminBell />
            <MaintenanceOverlay initialEnabled={maintenanceOn} />
            <MaintenanceBanner />
          </AuthProvider>
        </LanguageProvider>
        <div id="root-portal" />
      </body>
    </html>
  );
}
