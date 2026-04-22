import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageProvider } from "./i18n/LanguageContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "I Don't Know Tech | เครื่องมือทดสอบและสร้างห้องปฏิบัติการ",
  description:
    "ผู้เชี่ยวชาญด้านจำหน่าย ซ่อมบำรุง และสอบเทียบเครื่องมือทดสอบคุณภาพ พร้อมบริการออกแบบและสร้างห้องปฏิบัติการมาตรฐานสากล - I Don't Know Tech, Nonthaburi, Thailand",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
