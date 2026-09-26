// The Content-Disposition for a PDF streamed by /api/documents/proxy — so the
// browser saves it under the document's title instead of "document.pdf",
// which is what every download used to be called.

const FALLBACK = "document.pdf";
const MAX_NAME_CHARS = 120;

/**
 * `rawName` made safe as a file name: control characters and the characters
 * file systems refuse (\ / : * ? " < > |) become spaces, runs of space
 * collapse, a trailing ".pdf" is dropped (it is added back once), and the
 * length is capped by CHARACTER — slicing UTF-16 could split an emoji's
 * surrogate pair, and encodeURIComponent throws on half of one.
 */
export function cleanPdfBaseName(rawName: string | null | undefined): string {
  const cleaned = String(rawName ?? "")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .trim();
  return Array.from(cleaned).slice(0, MAX_NAME_CHARS).join("").trim();
}

/** RFC 5987 value-chars: encodeURIComponent, plus the four it leaves alone. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * `inline` or `attachment`, named after the document. The title goes in
 * `filename*` (UTF-8, so a Thai title survives — RFC 6266); `filename` carries
 * its ASCII letters for the rare client that ignores `filename*`, or
 * "document.pdf" when there are none. No name at all keeps the old header.
 */
export function pdfContentDisposition(
  kind: "inline" | "attachment",
  rawName: string | null | undefined
): string {
  const base = cleanPdfBaseName(rawName);
  if (!base) return `${kind}; filename="${FALLBACK}"`;
  const asciiBase = base.replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
  const ascii = /[A-Za-z0-9]/.test(asciiBase) ? `${asciiBase}.pdf` : FALLBACK;
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(`${base}.pdf`)}`;
}
