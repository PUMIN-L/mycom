// Pure URL parsing for the "YouTube" content block — no DOM/React dependency,
// so both the editor's live preview and the public renderer can share it.

/**
 * Extracts the 11-character video id from any common YouTube URL shape
 * (watch?v=, youtu.be/, /shorts/, /embed/). Returns null for anything else,
 * including a non-YouTube URL or garbage input.
 */
export function extractYoutubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return id || null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
    const match = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/);
    if (match) return match[1];
  }
  return null;
}

export function isValidYoutubeUrl(url: string | null | undefined): boolean {
  return extractYoutubeVideoId(url) !== null;
}
