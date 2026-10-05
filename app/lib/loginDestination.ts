// Where the login page sends someone once they are in: the page they were
// sent away from (proxy.ts puts it in ?next=), or the admin panel. Pure.
//
// The point is a sticker's QR (/assets/item/…, /stock/item/…): scanned on a
// phone that is not logged in, it used to land on /adminpanel after the
// login, not on the piece.
//
// `next` comes from the address bar, so only a page of THIS site is followed
// — never another site ("//evil.example", "/\evil.example", which browsers
// read as //, "https://…", "javascript:…"): the login page must not be a way
// to send someone elsewhere looking like they came from us.

const BASE = "http://this-site.invalid";

export function loginDestination(next: string | null | undefined, fallback = "/adminpanel"): string {
  if (!next || !next.startsWith("/")) return fallback;
  // Parsed the way a browser parses it — "/\x" and "/<tab>/x" both become
  // "//x" — so the origin check below sees where a navigation would go.
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // Back to the login page would only show the form again.
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
