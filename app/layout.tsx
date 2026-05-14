import type { Metadata } from "next";
import { Cormorant_Garamond, Inter, IBM_Plex_Sans_Thai } from "next/font/google";
import { LanguageProvider } from "./i18n/LanguageContext";
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
  title: "PROFIN | เครื่องมือทดสอบและสร้างห้องปฏิบัติการ",
  description:
    "ผู้เชี่ยวชาญด้านจำหน่าย ซ่อมบำรุง และสอบเทียบเครื่องมือทดสอบคุณภาพ พร้อมบริการออกแบบและสร้างห้องปฏิบัติการมาตรฐานสากล - Profin Lab scale, Nonthaburi, Thailand",
  keywords:
    "เครื่องทดสอบ, testing equipment, hardness tester, tensile tester, viscometer, colorimeter, COF tester, leak tester, lab construction, นนทบุรี",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${cormorant.variable} ${inter.variable} ${ibmPlexThai.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
