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
}

export interface ContentData {
  id: string;
  title: string;
  blocks: ContentBlock[];
  createdAt: string;
  productId?: string | null;
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
