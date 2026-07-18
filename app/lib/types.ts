// Single source of truth for the app's data models.
//
// IMPORTANT: keep this file free of any server-only imports (no `mysql2`,
// `cloudinary`, `next/headers`, etc.). It is imported by BOTH server code
// (`lib/*Store.ts`, route handlers) and client components, so it must stay a
// pure, dependency-free type module. The stores re-export these types, so most
// server code can keep importing from `./productStore` / `./contentStore`.

// ── Products ────────────────────────────────────────────────────────────────

export interface ProductCategory {
  id: number;
  name_th: string;
  name_en: string;
  name_zh: string;
  sortOrder: number;
}

export interface ProductData {
  id: string;
  categoryId: number;
  image: string;
  title_th: string;
  title_en: string;
  title_zh: string;
  desc_th: string;
  desc_en: string;
  desc_zh: string;
  createdAt: string;
  isPublished?: boolean;
}

// ── Contents ────────────────────────────────────────────────────────────────

export interface ContentBlock {
  id: string;
  type: "text" | "image" | "text-image" | "gallery";
  content?: string;
  imageUrl?: string;
  imageUrls?: string[];
  imagePosition?: "left" | "right";
  fontSize?: string;
  fontWeight?: string;
  textAlign?: string;
  textColor?: string;
  selectedImageIndex?: number;
  /** Image display width as a percentage (25–100). Undefined = 100 (legacy). */
  imageWidth?: number;
  /** Extra vertical gap below this block in px (0–100). Undefined = default spacing. */
  spacingBelow?: number;
}

export interface ContentData {
  id: string;
  title: string;
  blocks: ContentBlock[];
  createdAt: string;
  productId?: string | null;
}

// Lightweight projection for list / related-content views: everything those
// UIs need (title, counts, link, product link) WITHOUT the heavy blocks JSON,
// so pages don't serialize ~120KB of block content the client never renders.
export interface ContentMeta {
  id: string;
  title: string;
  createdAt: string;
  productId: string | null;
  textCount: number;
  imageCount: number;
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface DocumentData {
  id: string;
  title: string;
  description: string;
  pdfUrl: string;
  coverUrl: string;
  createdAt: string;
  sortOrder: number;
}
