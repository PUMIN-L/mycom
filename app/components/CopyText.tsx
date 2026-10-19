"use client";

/**
 * A phone number or e-mail that copies itself when clicked — inside a row that
 * opens a record on click, so the click (and Enter / Space on it) stops here.
 * Only those keys: stopping every key would also keep Esc from a modal's
 * window-level listener whenever this has focus. Shows "-" when there is
 * nothing to copy.
 */
export default function CopyText({
  value,
  onCopied,
  onFailed,
  className = "",
}: {
  value: string | null | undefined;
  onCopied?: () => void;
  onFailed?: () => void;
  className?: string;
}) {
  const text = (value || "").trim();
  if (!text) return <span className={className}>-</span>;
  return (
    <button
      type="button"
      title="คลิกเพื่อคัดลอก"
      aria-label={`คัดลอก ${text}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          // No clipboard (plain http) throws here too, and is reported the same.
          await navigator.clipboard.writeText(text);
          onCopied?.();
        } catch {
          onFailed?.();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
      className={`text-left hover:text-orange-600 hover:underline decoration-dotted underline-offset-2 transition-colors ${className}`}
    >
      {text}
    </button>
  );
}
