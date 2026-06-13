"use client";

import { useState, use } from "react";
import { useT, useLanguage } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import { useAuth } from "../context/AuthContext";
import { localize } from "../lib/localize";
import ConfirmDialog from "./ConfirmDialog";
import Toast from "./Toast";
import Image from "next/image";
import Link from "next/link";
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

export default function Products({ dataPromise }: ProductsProps) {
  const t = useT();
  const { lang } = useLanguage();
  const { isLoggedIn } = useAuth();

  // Suspends until the server data resolves; the resolved value seeds local
  // state so admin mutations (add/delete) can update the UI optimistically.
  const { categories: initialCategories, products: initialProducts } =
    use(dataPromise);

  const [categories, setCategories] =
    useState<ProductCategory[]>(initialCategories);
  const [products, setProducts] = useState<ProductData[]>(initialProducts);
  const [selectedCategory, setSelectedCategory] = useState(
    () => initialCategories[0]?.id ?? 0
  );

  const [pendingDeleteCat, setPendingDeleteCat] = useState<number | null>(null);
  const [deletingCat, setDeletingCat] = useState(false);

  const [pendingDeleteProd, setPendingDeleteProd] = useState<string | null>(null);
  const [deletingProd, setDeletingProd] = useState(false);

  const [loadingId, setLoadingId] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Switch category (and, on desktop, scroll the product area into view). Shared
  // by the click and keyboard handlers so the category nav is reachable by keyboard.
  const selectCategory = (id: number) => {
    if (window.innerWidth >= 1024) {
      const element = document.getElementById("product-content");
      if (element) {
        element.scrollIntoView({ behavior: "auto", block: "start" });
      }
    }
    setSelectedCategory(id);
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
        setSelectedCategory(categories[0]?.id || 0);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast("ไม่สามารถลบหมวดหมู่ได้: " + message, "error");
    } finally {
      setDeletingCat(false);
      setPendingDeleteCat(null);
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

  const filteredItems = products.filter(
    (item) => item.categoryId === selectedCategory
  );

  // Localized text with fallback (zh -> en -> th, en -> th). See lib/localize.
  const getTitle = (p: ProductData) => localize(p, "title", lang);
  const getDesc = (p: ProductData) => localize(p, "desc", lang);
  const getCatName = (cat: ProductCategory) => localize(cat, "name", lang);

  return (
    <section id="products" className="py-24 md:py-32 lg:py-10  bg-[var(--bg-secondary)] relative">
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
              <div className="grid grid-rows-2 grid-flow-col lg:flex lg:flex-col gap-x-4 gap-y-2 lg:gap-4 overflow-x-auto no-scrollbar -mx-4 px-4 lg:mx-0 lg:px-0">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={category.id === selectedCategory}
                    onClick={() => selectCategory(category.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectCategory(category.id);
                      }
                    }}
                    className={`group text-left transition-all duration-300 flex-shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${category.id === selectedCategory
                      ? "text-[var(--accent)]"
                      : "text-gray-500 hover:text-[var(--text-primary)]"
                      }`}
                  >
                    <div className="flex items-center justify-between w-full pr-2">
                      <span className="relative py-2 font-serif text-base md:text-lg tracking-wide inline-block whitespace-nowrap">
                        {getCatName(category)}
                        <div
                          className={`absolute bottom-0 left-0 h-[2px] bg-[var(--accent)] transition-all duration-500 ${category.id === selectedCategory ? "w-full" : "w-0 group-hover:w-full opacity-30"
                            }`}
                        />
                      </span>
                      {isLoggedIn && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteCat(category.id);
                          }}
                          className="ml-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                          aria-label="ลบหมวดหมู่"
                          title="ลบหมวดหมู่"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Product Grid */}
          <div className="lg:flex-1 min-h-[650px]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {filteredItems.map((item, i) => {
                return (
                  <Link
                    key={`${selectedCategory}-${item.id}`}
                    href={`/showcase/product/${item.id}`}
                    onClick={() => setLoadingId(item.id)}
                    className={`group flex flex-col bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-xl hover:shadow-black/[0.04] overflow-hidden transition-all duration-300 ${
                      loadingId === item.id ? "cursor-wait opacity-80 scale-[0.98]" : "cursor-pointer"
                    }`}
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div className="relative aspect-[4/3] sm:aspect-square overflow-hidden bg-white border-b border-gray-50">
                      <Image
                        src={item.image}
                        alt={getTitle(item)}
                        fill
                        sizes="(max-width: 1024px) 100vw, 30vw"
                        className="object-contain p-8 transition-transform duration-700 ease-out group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black-[0.02] transition-colors duration-500" />

                      {/* Delete Button for Admin */}
                      {isLoggedIn && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPendingDeleteProd(item.id);
                          }}
                          className="absolute top-4 right-4 p-2 bg-white/90 text-red-500 rounded-full shadow-lg hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 z-20"
                          aria-label="ลบสินค้า"
                          title="ลบสินค้า"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col flex-1 p-6 relative z-10 bg-white">
                      <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2 transition-colors group-hover:text-[var(--accent)] line-clamp-2">
                        {getTitle(item)}
                      </h3>
                      <p className="text-gray-500 leading-relaxed font-light text-sm line-clamp-2 mb-6">
                        {getDesc(item)}
                      </p>
                      <div className="mt-auto flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--accent)] group/btn">
                        <span className="border-b border-transparent group-hover/btn:border-[var(--accent)] transition-all duration-300">
                          View Details
                        </span>
                        <svg
                          className="w-4 h-4 transition-transform duration-300 group-hover/btn:translate-x-1"
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
          </div>
        </div>
      </div>
    </section>
  );
}
