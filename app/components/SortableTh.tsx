import type { ReactNode } from "react";
import type { SortDir } from "../customers/listHelpers";

/**
 * A table header that sorts its column when clicked. `dir` is set when this
 * column is the one sorted on; the arrow (and aria-sort) say which way.
 */
export default function SortableTh({
  children,
  dir,
  onSort,
  className = "",
}: {
  children: ReactNode;
  dir: SortDir | null;
  onSort: () => void;
  className?: string;
}) {
  return (
    <th className={className} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button
        type="button"
        onClick={onSort}
        className={`inline-flex items-center gap-1 uppercase tracking-wider font-semibold hover:text-gray-900 transition-colors ${dir ? "text-gray-900" : ""}`}
      >
        {children}
        <span aria-hidden="true" className={dir ? "text-orange-500" : "text-gray-300"}>
          {dir === "asc" ? "↑" : dir === "desc" ? "↓" : "↕"}
        </span>
      </button>
    </th>
  );
}
