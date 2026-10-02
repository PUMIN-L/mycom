import type { Metadata } from "next";

// The page itself is a Client Component, which cannot export metadata.
export const metadata: Metadata = {
  title: "ลืมรหัสผ่าน",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
