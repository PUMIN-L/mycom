import type { Metadata } from "next";
import type { ReactNode } from "react";

// The accounting module (ARCHITECTURE.md §8g). Gated by proxy.ts; its routes
// also demand two-factor login. Never indexed: it is an internal tool.
export const metadata: Metadata = {
  title: "ระบบบัญชี",
  robots: { index: false, follow: false },
};

export default function AccountingLayout({ children }: { children: ReactNode }) {
  return children;
}
