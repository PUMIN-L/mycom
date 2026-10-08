import type { Metadata } from "next";
import { draftMode } from "next/headers";
import CatalogClient from "./CatalogClient";
import { getAllDocuments, isDocumentPublic } from "../lib/documentStore";
import { getSession } from "../lib/session";
import { pageMetadata } from "../lib/pageMetadata";

// Cached (ISR) for visitors: every documents write calls
// revalidateTag("documents"), which getAllDocuments reads through, so a change
// shows at once and 60 s is only the backstop.
//
// A hidden catalog, and the button that hides or shows one, exist only for an
// admin — rendered in Draft Mode (session.ts turns it on for a logged-in
// admin) and there only. The session is read ONLY in Draft Mode, so the cached
// copy never depends on who asked; the same rule as /showcase/[id].
export const revalidate = 60;

/** The admin's session — read only in Draft Mode (see above); null otherwise. */
async function adminSession() {
  return (await draftMode()).isEnabled ? getSession() : null;
}

// The canonical matters: without one the page inherits the root layout's ("/")
// and tells Google it's a duplicate of the homepage — dropping /catalog from
// the index. No brand in the title: the root template appends it (it used to
// be written here too, so <title> ended "| Profin Lab Scale | Profin Lab Scale").
export const metadata: Metadata = pageMetadata({
  title: "แคตตาล็อกสินค้า (Product Catalogs)",
  description:
    "แคตตาล็อกสินค้า โบรชัวร์ และเอกสารข้อมูลเครื่องมือทดสอบจาก Profin Lab Scale — Download product catalogs, brochures & datasheets",
  path: "/catalog",
});

export default async function CatalogPage() {
  const [documents, session] = await Promise.all([getAllDocuments(), adminSession()]);
  // Navbar/main/Footer live in layout.tsx (shared with loading.tsx).
  return (
    <CatalogClient
      // A new component when the copy changes between the visitor's and the
      // admin's: its list is seeded from these props once.
      key={session ? "admin" : "visitor"}
      adminView={!!session}
      initialDocuments={session ? documents : documents.filter(isDocumentPublic)}
    />
  );
}
