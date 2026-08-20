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

const cormorant = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const ibmPlexThai = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${cormorant.variable} ${inter.variable} ${ibmPlexThai.variable} antialiased`}
    >
      <body className="min-h-screen flex flex-col font-sans">
        <LanguageProvider>
          <AuthProvider>
            <NavProvider>{children}</NavProvider>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
