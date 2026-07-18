"use client";

import { useState, use, useEffect, useRef } from "react";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import { useAuth } from "../context/AuthContext";
import { localize } from "../lib/localize";
import ConfirmDialog from "./ConfirmDialog";
import Toast from "./Toast";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductCategory, ProductData } from "../lib/types";

interface ProductsProps {
  // Promise created on the server and passed down so the data is fetched during
  // SSR (rendered into the streamed HTML) instead of after hydration. While it
  // is pending, the <Suspense> fallback (<ProductsSkeleton>) is shown.
  dataPromise: Promise<{
    categories: ProductCategory[];
    products: ProductData[];
  }>;
}

// Which page buttons to show: the first 3 and last 3 pages, plus a window around
// the current page, with "…" filling the gaps (e.g. 1 2 3 … 8 9 10). Small
// counts (<=7) show every page.
function pageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>();
  for (const p of [1, 2, 3, total - 2, total - 1, total, current - 1, current, current + 1]) {
    if (p >= 1 && p <= total) keep.add(p);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

// Persist list position (category + page) in this key so returning from a
// product detail via Back restores it (state alone resets on remount).
const LIST_POS_KEY = "products-list-pos";

export default function Products({ dataPromise }: ProductsProps) {
  const t = useT();
  const { lang } = useLanguage();
  const { isLoggedIn } = useAuth();
  const router = useRouter();

  // Suspends until the server data resolves; the resolved value seeds local
  // state so admin mutations (add/delete) can update the UI optimistically.
  const { categories: initialCategories, products: initialProducts } =
    use(dataPromise);

  const [categories, setCategories] =
    useState<ProductCategory[]>(initialCategories);
  const [products, setProducts] = useState<ProductData[]>(initialProducts);

  // Synthetic category id: -1 represents "All Products"
  const allCategory: ProductCategory = {
    id: -1,
    name_th: "เครื่องทดสอบทั้งหมด",
    name_en: "All Products",
    name_zh: "所有产品",
    sortOrder: -1,
  };
  const allCategories = [allCategory, ...categories];

  const [selectedCategory, setSelectedCategory] = useState(-1);
  const [currentPage, setCurrentPage] = useState(1);

  // Restore the saved list position on mount (e.g. after Back from a detail
  // page). Read in an effect (not initial state) to keep SSR/hydration matching.
  const restoredRef = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(LIST_POS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.cat === "number") setSelectedCategory(s.cat);
        if (typeof s.page === "number" && s.page >= 1) setCurrentPage(s.page);
      }
    } catch {
      /* unavailable/corrupt — ignore */
    }
    restoredRef.current = true;
  }, []);

  // Persist it whenever it changes (skip the initial mount so we don't clobber
  // the value the restore effect is about to read).
  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      sessionStorage.setItem(
        LIST_POS_KEY,
        JSON.stringify({ cat: selectedCategory, page: currentPage })
      );
    } catch {
      /* storage full/blocked — nonfatal */
    }
  }, [selectedCategory, currentPage]);

  const ITEMS_PER_PAGE = 9;
  const CATEGORIES_LIMIT = 10;
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [searchCategory, setSearchCategory] = useState("");
  const [searchProduct, setSearchProduct] = useState("");

  const [pendingDeleteCat, setPendingDeleteCat] = useState<number | null>(null);
  const [deletingCat, setDeletingCat] = useState(false);
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [savingCat, setSavingCat] = useState(false);
  const [draggedCatIndex, setDraggedCatIndex] = useState<number | null>(null);
  const [dragOverCatIndex, setDragOverCatIndex] = useState<number | null>(null);

  const [pendingDeleteProd, setPendingDeleteProd] = useState<string | null>(null);
  const [deletingProd, setDeletingProd] = useState(false);

  const [pendingPublishToggle, setPendingPublishToggle] = useState<string | null>(null);
  const [publishConfirmText, setPublishConfirmText] = useState("");
  const [togglingPublish, setTogglingPublish] = useState(false);
  // Id of the product whose publish status is currently being changed, so we
  // can show a spinner on that product's eye icon while the request is in flight.
  const [publishTogglingId, setPublishTogglingId] = useState<string | null>(null);

  const [loadingId, setLoadingId] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const ensureInputVisible = (target: HTMLInputElement) => {
    const rect = target.getBoundingClientRect();
    const isInViewport = rect.top >= 120 && rect.bottom <= window.innerHeight;
    if (!isInViewport) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Switch category (and, on desktop, scroll the product area into view). Shared
  // by the click and keyboard handlers so the category nav is reachable by keyboard.
  const selectCategory = (id: number) => {
    if (window.innerWidth >= 1024) {
      const element = document.getElementById("product-content");
      if (element) {
        const y = element.getBoundingClientRect().top + window.scrollY - 122;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    }
    setSelectedCategory(id);
    setCurrentPage(1); // Reset to first page when category changes
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    const element = document.getElementById("product-content");
    if (element) {
      // Offset scrolling slightly so the header isn't completely flush
      const y = element.getBoundingClientRect().top + window.scrollY - 122;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  const handleDeleteCategory = async () => {
    if (pendingDeleteCat === null) return;
    setDeletingCat(true);
    const id = pendingDeleteCat;
    try {
      const res = await fetch(`/api/products/categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete category");
      }
      // success
      setCategories(categories.filter(c => c.id !== id));
      if (selectedCategory === id) {
        setSelectedCategory(-1);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("ไม่สามารถลบหมวดหมู่ได้: " + message, "error");
    } finally {
      setDeletingCat(false);
      setPendingDeleteCat(null);
    }
  };

  const handleUpdateCategory = async (id: number) => {
    if (!editingCatName.trim()) return;
    setSavingCat(true);

    // Find the current category to keep other language names unchanged
    const category = categories.find((c) => c.id === id);
    if (!category) return;

    // We update the name based on current language
    const updatedPayload = {
      name_th: lang === "th" ? editingCatName : category.name_th,
      name_en: lang === "en" ? editingCatName : category.name_en,
      name_zh: lang === "zh" ? editingCatName : category.name_zh,
    };

    try {
      const res = await fetch(`/api/products/categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPayload)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update category");
      }
      // success: update local state
      setCategories(categories.map((c) =>
        c.id === id ? { ...c, ...updatedPayload } : c
      ));
      setEditingCatId(null);
      showToast("อัปเดตชื่อหมวดหมู่เรียบร้อยแล้ว", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("ไม่สามารถอัปเดตหมวดหมู่ได้: " + message, "error");
    } finally {
      setSavingCat(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!isLoggedIn) return;
    setDraggedCatIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    if (!isLoggedIn || index < 0) return;
    e.preventDefault();
    setDragOverCatIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isLoggedIn) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, index: number) => {
    if (!isLoggedIn || index < 0) return;
    e.preventDefault();
    setDragOverCatIndex(null);
    if (draggedCatIndex === null || draggedCatIndex === index) return;

    const newCategories = [...categories];
    const [draggedItem] = newCategories.splice(draggedCatIndex, 1);
    newCategories.splice(index, 0, draggedItem);

    setCategories(newCategories);
    setDraggedCatIndex(null);

    try {
      const res = await fetch("/api/products/categories/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds: newCategories.map(c => c.id) })
      });
      if (!res.ok) throw new Error("Failed to save reorder");
    } catch (err) {
      console.error(err);
      showToast("ไม่สามารถบันทึกตำแหน่งใหม่ได้", "error");
    }
  };

  const handleDeleteProduct = async () => {
    if (!pendingDeleteProd) return;
    setDeletingProd(true);
    const id = pendingDeleteProd;
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Failed to delete product");
      }
      // success
      setProducts(products.filter(p => p.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("ไม่สามารถลบสินค้าได้: " + message, "error");
    } finally {
      setDeletingProd(false);
      setPendingDeleteProd(null);
    }
  };

  const executePublishToggle = async (id: string, newStatus: boolean) => {
    setTogglingPublish(true);
    setPublishTogglingId(id);
    try {
      const p = products.find(prod => prod.id === id);
      if (!p) return;

      const updatedPayload = { ...p, isPublished: newStatus };
      const res = await fetch(`/api/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPayload)
      });
      if (!res.ok) throw new Error("Failed to update status");

      setProducts(products.map(prod => prod.id === id ? { ...prod, isPublished: newStatus } : prod));
      showToast(newStatus ? "เผยแพร่สินค้าเรียบร้อยแล้ว" : "ซ่อนสินค้าแล้ว", "success");
    } catch (err) {
      showToast("ไม่สามารถเปลี่ยนสถานะได้", "error");
    } finally {
      setTogglingPublish(false);
      setPublishTogglingId(null);
      setPendingPublishToggle(null);
    }
  };

  const handleTogglePublish = (id: string, currentStatus: boolean) => {
    if (currentStatus === false) {
      // Trying to publish, show modal
      setPendingPublishToggle(id);
      setPublishConfirmText("");
    } else {
      // Trying to unpublish, do it directly
      executePublishToggle(id, false);
    }
  };

  // Localized text with fallback (zh -> en -> th, en -> th). See lib/localize.
  const getTitle = (p: ProductData) => localize(p, "title", lang);
  const getDesc = (p: ProductData) => localize(p, "desc", lang);
  const getCatName = (cat: ProductCategory) => localize(cat, "name", lang);

  const visibleProducts = isLoggedIn ? products : products.filter(p => p.isPublished !== false);

  const filteredCategories = allCategories.filter((cat) => {
    if (!isLoggedIn && cat.id !== -1) {
      const hasPublishedProduct = visibleProducts.some(p => p.categoryId === cat.id);
      if (!hasPublishedProduct) return false;
    }
    if (!searchCategory) return true;
    return getCatName(cat).toLowerCase().includes(searchCategory.toLowerCase());
  });

  const filteredItems = visibleProducts.filter((item) => {
    const matchesCategory = selectedCategory === -1 || item.categoryId === selectedCategory;
    const matchesSearch = !searchProduct || getTitle(item).toLowerCase().includes(searchProduct.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // When an admin is logged in, the SSR/ISR payload only contains published
  // products (unpublished ones are filtered server-side so they never leak to
  // anonymous visitors). Re-fetch the full list from the authenticated API so
  // admins can still see and manage hidden/draft products.
  useEffect(() => {
    if (!isLoggedIn) return;
    let ignore = false;
    (async () => {
      try {
        const res = await fetch("/api/products");
        if (!res.ok) return;
        const all: ProductData[] = await res.json();
        if (!ignore) setProducts(all);
      } catch {
        /* keep the SSR data if the refetch fails */
      }
    })();
    return () => {
      ignore = true;
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (searchCategory && filteredCategories.length === 1) {
      const catId = filteredCategories[0].id;
      if (selectedCategory !== catId) {
        setSelectedCategory(catId);
        setCurrentPage(1);
      }
    }
  }, [searchCategory, filteredCategories.length, selectedCategory, filteredCategories]);

  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);

  // Clamp the current page when the result set shrinks (e.g. after deleting a
  // product on the last page), so the grid never ends up blank with no
  // pagination controls to escape.
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(Math.max(1, totalPages));
    }
  }, [totalPages, currentPage]);

  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  return (
    <section id="products" className="py-24 md:py-32 lg:py-10 bg-[var(--bg-secondary)] relative overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} />}
      {/* Decorative background element */}
      <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-[var(--accent)] opacity-[0.03] rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2" />

      <div className="section-wrapper relative z-10">
        {pendingDeleteCat !== null && (
          <ConfirmDialog
            message={"คุณแน่ใจหรือไม่ที่จะลบหมวดหมู่นี้?\n(ต้องลบสินค้าในหมวดหมู่นี้ให้หมดก่อนจึงจะลบได้)"}
            onConfirm={handleDeleteCategory}
            onCancel={() => setPendingDeleteCat(null)}
            loading={deletingCat}
          />
        )}
        {pendingDeleteProd !== null && (
          <ConfirmDialog
            message={"คุณแน่ใจหรือไม่ที่จะลบสินค้านี้?\nระบบจะลบรูปภาพจากเซิร์ฟเวอร์ด้วย"}
            onConfirm={handleDeleteProduct}
            onCancel={() => setPendingDeleteProd(null)}
            loading={deletingProd}
          />
        )}
        {pendingPublishToggle !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 sm:p-8 animate-in zoom-in-95 duration-200">
              <h3 className="text-xl font-bold text-gray-900 mb-4">ยืนยันการเผยแพร่</h3>
              <p className="text-gray-600 mb-6">
                หากต้องการเปลี่ยนเป็นเผยแพร่ โปรดพิมพ์คำว่า <strong className="text-orange-500">publish</strong> เพื่อยืนยัน
              </p>
              <input
                type="text"
                value={publishConfirmText}
                onChange={(e) => setPublishConfirmText(e.target.value)}
                placeholder="พิมพ์ publish"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 mb-6"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setPendingPublishToggle(null)}
                  disabled={togglingPublish}
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={() => executePublishToggle(pendingPublishToggle, true)}
                  disabled={publishConfirmText !== 'publish' || togglingPublish}
                  className="px-5 py-2.5 rounded-xl font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {togglingPublish ? "กำลังบันทึก..." : "ตกลง"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Section Header */}
        <div className="text-center mb-16 md:mb-24 animate-fade-in-up">
          <h2 className="text-xl md:text-4xl font-serif text-[var(--accent)] mb-6">
            {t(translations.products.title)}
          </h2>

          {/* Admin Controls */}
          {isLoggedIn && (
            <div className="flex justify-center mt-6">
              <Link
                href="/create-product"
                className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition-colors shadow-sm"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                สร้าง Product ใหม่
              </Link>
            </div>
          )}
        </div>

        <div id="product-content" className="flex flex-col lg:flex-row gap-12 lg:gap-16 scroll-mt-32">
          {/* Sidebar Navigation */}
          <div className="lg:w-1/5 w-full flex-shrink-0">
            <div className="lg:sticky lg:top-32 self-start mb-12 lg:mb-0">
              {/* Category Search Input */}
              <div className="mb-6 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="ค้นหาหมวดหมู่..."
                  value={searchCategory}
                  onChange={(e) => {
                    setSearchCategory(e.target.value);
                    ensureInputVisible(e.target);
                  }}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm"
                />
              </div>

              <div className="grid grid-rows-2 grid-flow-col lg:flex lg:flex-col gap-x-4 gap-y-2 lg:gap-4 overflow-x-auto no-scrollbar -mx-4 px-4 lg:mx-0 lg:px-0">
                {(showAllCategories ? filteredCategories : filteredCategories.slice(0, CATEGORIES_LIMIT)).map((category, index) => {
                  const isAllCat = category.id === -1;
                  // Calculate the actual index in the full list for drag & drop
                  const actualIndex = allCategories.findIndex(c => c.id === category.id) - 1;
                  return (
                    <div
                      key={category.id}
                      role="button"
                      tabIndex={0}
                      draggable={isLoggedIn && editingCatId === null && !isAllCat}
                      onDragStart={(e) => handleDragStart(e, actualIndex)}
                      onDragEnter={(e) => handleDragEnter(e, actualIndex)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, actualIndex)}
                      onDragEnd={() => { setDraggedCatIndex(null); setDragOverCatIndex(null); }}
                      aria-pressed={category.id === selectedCategory}
                      onClick={() => selectCategory(category.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectCategory(category.id);
                        }
                      }}
                      className={`group text-left transition-all duration-300 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${category.id === selectedCategory
                        ? "text-[var(--accent)]"
                        : "text-gray-500 hover:text-[var(--text-primary)]"
                        } ${isLoggedIn && editingCatId === null && !isAllCat ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
                      ${dragOverCatIndex === actualIndex && !isAllCat ? (draggedCatIndex !== null && actualIndex > draggedCatIndex ? "border-b-2 border-orange-400 pb-1 -mb-[6px]" : "border-t-2 border-orange-400 pt-1 -mt-[6px]") : ""}
                      ${draggedCatIndex === actualIndex && !isAllCat ? "opacity-30" : ""}
                    `}
                    >
                      <div className="flex items-center justify-between w-full pr-2">
                        {editingCatId === category.id ? (
                          <div className="flex items-center gap-2 w-full mr-2" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingCatName}
                              onChange={(e) => setEditingCatName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateCategory(category.id);
                                if (e.key === 'Escape') setEditingCatId(null);
                              }}
                              className="w-full px-2 py-1 text-sm border-b-2 border-orange-400 bg-orange-50/50 focus:outline-none text-gray-800"
                              autoFocus
                              disabled={savingCat}
                            />
                            <button
                              onClick={() => handleUpdateCategory(category.id)}
                              disabled={savingCat || !editingCatName.trim()}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setEditingCatId(null)}
                              disabled={savingCat}
                              className="p-1 text-red-500 hover:bg-red-50 rounded"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span className="relative py-2 font-serif text-base md:text-lg tracking-wide inline-block whitespace-nowrap lg:whitespace-normal lg:break-words leading-tight">
                            {getCatName(category)}
                            <div
                              className={`absolute bottom-0 left-0 h-[2px] bg-[var(--accent)] transition-all duration-500 ${category.id === selectedCategory ? "w-full" : "w-0 group-hover:w-full opacity-30"
                                }`}
                            />
                          </span>
                        )}

                        {isLoggedIn && !isAllCat && editingCatId !== category.id && (
                          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingCatId(category.id);
                                setEditingCatName(getCatName(category));
                              }}
                              className="ml-1 p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors"
                              aria-label="แก้ไขหมวดหมู่"
                              title="แก้ไขหมวดหมู่"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteCat(category.id);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                              aria-label="ลบหมวดหมู่"
                              title="ลบหมวดหมู่"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {filteredCategories.length === 0 && (
                  <div className="text-sm text-gray-400 italic py-2">
                    ไม่พบหมวดหมู่ที่ค้นหา
                  </div>
                )}
                {filteredCategories.length > CATEGORIES_LIMIT && (
                  <div className="flex items-center lg:items-start py-2 lg:py-1 pr-4 lg:pr-0">
                    <button
                      onClick={() => setShowAllCategories(!showAllCategories)}
                      className="group flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-[var(--accent)] transition-colors focus:outline-none"
                    >
                      {showAllCategories ? (
                        <>
                          <span className="border-b border-transparent group-hover:border-[var(--accent)] transition-colors">แสดงน้อยลง</span>
                          <svg className="w-4 h-4 transition-transform group-hover:-translate-y-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                        </>
                      ) : (
                        <>
                          <span className="border-b border-transparent group-hover:border-[var(--accent)] transition-colors">ดูทั้งหมด ({filteredCategories.length - CATEGORIES_LIMIT})</span>
                          <svg className="w-4 h-4 transition-transform group-hover:translate-y-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Product Grid Area */}
          <div className="lg:flex-1 flex flex-col min-h-[650px]">
            {/* Product Search & Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="text-gray-500 text-sm font-medium whitespace-nowrap flex-shrink-0">
                พบสินค้า <span className="text-[var(--accent)] font-bold">{filteredItems.length}</span> รายการ
              </div>
              <div className="relative w-full flex-1 ml-0 sm:ml-4">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="ค้นหาสินค้า..."
                  value={searchProduct}
                  onChange={(e) => {
                    setSearchProduct(e.target.value);
                    setCurrentPage(1);
                    ensureInputVisible(e.target);
                  }}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 content-start">
              {paginatedItems.map((item, i) => {
                return (
                  <Link
                    key={`${selectedCategory}-${item.id}`}
                    href={`/showcase/product/${item.id}`}
                    onClick={() => setLoadingId(item.id)}
                    className={`group flex flex-col rounded-2xl border overflow-hidden transition-all duration-300 ${loadingId === item.id ? "cursor-wait opacity-80 scale-[0.98]" : "cursor-pointer"} ${item.isPublished === false ? "opacity-75 bg-gray-50 border-gray-200 grayscale-[0.5]" : "bg-white border-gray-100 hover:border-gray-200 hover:shadow-xl hover:shadow-black/[0.04]"}`}
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div className={`relative aspect-[4/3] sm:aspect-square overflow-hidden border-b border-gray-50 ${item.isPublished === false ? "bg-gray-100" : "bg-white"}`}>
                      <Image
                        src={item.image}
                        alt={getTitle(item)}
                        fill
                        sizes="(max-width: 1024px) 100vw, 30vw"
                        className={`object-contain p-8 transition-transform duration-700 ease-out ${item.isPublished === false ? "grayscale opacity-80 mix-blend-multiply" : "group-hover:scale-105"}`}
                      />
                      <div className={`absolute inset-0 bg-black/0 transition-colors duration-500 ${item.isPublished === false ? "" : "group-hover:bg-black/[0.02]"}`} />

                      {/* Admin Actions */}
                      {isLoggedIn && (
                        <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all z-20">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (publishTogglingId === item.id) return;
                              handleTogglePublish(item.id, item.isPublished !== false);
                            }}
                            disabled={publishTogglingId === item.id}
                            className={`p-2 rounded-full shadow-lg transition-all disabled:cursor-wait ${item.isPublished !== false ? "bg-white/90 text-green-500 hover:bg-green-500 hover:text-white" : "bg-gray-100 text-gray-400 hover:bg-gray-500 hover:text-white"}`}
                            aria-label={item.isPublished !== false ? "ซ่อนสินค้า" : "เผยแพร่สินค้า"}
                            title={item.isPublished !== false ? "ซ่อนสินค้า" : "เผยแพร่สินค้า"}
                          >
                            {publishTogglingId === item.id ? (
                              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : item.isPublished !== false ? (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              router.push(`/edit-product/${item.id}`);
                            }}
                            className="p-2 bg-white/90 text-blue-500 rounded-full shadow-lg hover:bg-blue-500 hover:text-white transition-all"
                            aria-label="แก้ไขสินค้า"
                            title="แก้ไขสินค้า"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setPendingDeleteProd(item.id);
                            }}
                            className="p-2 bg-white/90 text-red-500 rounded-full shadow-lg hover:bg-red-500 hover:text-white transition-all"
                            aria-label="ลบสินค้า"
                            title="ลบสินค้า"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className={`flex flex-col flex-1 p-6 relative z-10 ${item.isPublished === false ? "bg-gray-50" : "bg-white"}`}>
                      <h3 className={`text-lg font-bold text-[var(--text-primary)] mb-2 transition-colors line-clamp-2 ${item.isPublished === false ? "" : "group-hover:text-[var(--accent)]"}`}>
                        {getTitle(item)}
                      </h3>
                      <div
                        className="text-gray-500 leading-relaxed font-light text-sm line-clamp-2 mb-6 [&_p]:inline [&_p]:m-0"
                        dangerouslySetInnerHTML={{ __html: getDesc(item) }}
                      />
                      <div className="mt-auto flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--accent)] group/btn">
                        <span className={`border-b border-transparent transition-all duration-300 ${item.isPublished === false ? "" : "group-hover/btn:border-[var(--accent)]"}`}>
                          View Details
                        </span>
                        <svg
                          className={`w-4 h-4 transition-transform duration-300 ${item.isPublished === false ? "" : "group-hover/btn:translate-x-1"}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {filteredItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-32 text-center animate-fade-in">
                <div className="w-16 h-[1px] bg-[var(--accent)] mb-8" />
                <p className="text-gray-400 font-serif text-2xl italic">
                  More products arriving soon
                </p>
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-12 mb-8 flex items-center justify-center gap-2">
                <button
                  onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  aria-label="หน้าก่อนหน้า"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <div className="flex items-center gap-2">
                  {pageList(currentPage, totalPages).map((p, idx) =>
                    p === "…" ? (
                      <span key={`gap-${idx}`} className="px-1 text-gray-400">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => handlePageChange(p)}
                        className={`w-10 h-10 flex items-center justify-center rounded-lg font-medium transition-colors ${currentPage === p
                          ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
                          : "bg-white border border-gray-200 text-gray-600 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200"
                          }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>

                <button
                  onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  aria-label="หน้าถัดไป"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
