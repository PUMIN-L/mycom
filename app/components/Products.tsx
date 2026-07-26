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
import { pageList } from "../lib/pagination";
import RichTextEditor from "./RichTextEditor";
import { stripHtml } from "../lib/stripHtml";

interface ProductsProps {
  // Promise created on the server and passed down so the data is fetched during
  // SSR (rendered into the streamed HTML) instead of after hydration. While it
  // is pending, the <Suspense> fallback (<ProductsSkeleton>) is shown.
  dataPromise: Promise<{
    categories: ProductCategory[];
    products: ProductData[];
  }>;
}

// Persist list position (category + page) in this key so returning from a
// product detail via Back restores it (state alone resets on remount).
const LIST_POS_KEY = "products-list-pos";

const SortInput = ({ 
  initialValue, 
  max, 
  onConfirm 
}: { 
  initialValue: number; 
  max: number; 
  onConfirm: (val: number) => void;
}) => {
  const [val, setVal] = useState<string>(initialValue.toString());
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setVal(initialValue.toString());
    setIsEditing(false);
  }, [initialValue]);

  const handleConfirm = () => {
    const num = parseInt(val);
    if (!isNaN(num) && num !== initialValue) {
      onConfirm(num);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setVal(initialValue.toString());
    setIsEditing(false);
  };

  return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <input
        type="number"
        min="1"
        max={max}
        value={val}
        onChange={e => {
          setVal(e.target.value);
          setIsEditing(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') handleConfirm();
          if (e.key === 'Escape') handleCancel();
        }}
        className="w-14 text-center text-xs border border-gray-200 rounded p-1.5 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-colors"
        title="พิมพ์ลำดับที่ต้องการ"
      />
      {isEditing && val !== initialValue.toString() && (
        <div className="flex items-center gap-1">
          <button 
            onClick={(e) => { e.stopPropagation(); handleConfirm(); }} 
            className="w-6 h-6 flex items-center justify-center bg-green-500 text-white rounded hover:bg-green-600 transition-colors shadow-sm"
            title="ยืนยัน"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); handleCancel(); }} 
            className="w-6 h-6 flex items-center justify-center bg-red-500 text-white rounded hover:bg-red-600 transition-colors shadow-sm"
            title="ยกเลิก"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}
    </div>
  );
};

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
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

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
  const [debouncedSearchProduct, setDebouncedSearchProduct] = useState("");

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchProduct(searchProduct);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchProduct]);

  const [pendingDeleteCat, setPendingDeleteCat] = useState<number | null>(null);
  const [deletingCat, setDeletingCat] = useState(false);
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [savingCat, setSavingCat] = useState(false);
  const [draggedCatIndex, setDraggedCatIndex] = useState<number | null>(null);
  const [dragOverCatIndex, setDragOverCatIndex] = useState<number | null>(null);

  const [pendingDeleteProd, setPendingDeleteProd] = useState<string | null>(null);
  const [deletingProd, setDeletingProd] = useState(false);
  const [draggedProdId, setDraggedProdId] = useState<string | null>(null);
  const [dragOverProdId, setDragOverProdId] = useState<string | null>(null);
  const dragEndTimeRef = useRef<number>(0);

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
      router.refresh();
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
      router.refresh();
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
      router.refresh();
    } catch (err) {
      console.error(err);
      setCategories(categories); // Rollback optimistic UI
      showToast("ไม่สามารถบันทึกตำแหน่งใหม่ได้", "error");
    }
  };

  const canDrag = isLoggedIn && searchProduct.trim() === "";

  const handleProdDragStart = (e: React.DragEvent, id: string) => {
    if (!canDrag) return;
    setDraggedProdId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleProdDragEnter = (e: React.DragEvent, id: string) => {
    if (!canDrag) return;
    e.preventDefault();
    setDragOverProdId(id);
  };

  const handleProdDrop = async (e: React.DragEvent, targetId: string) => {
    if (!canDrag || !draggedProdId || draggedProdId === targetId) {
      setDragOverProdId(null);
      return;
    }
    e.preventDefault();
    setDragOverProdId(null);

    const sourceIdx = products.findIndex(p => p.id === draggedProdId);
    const targetIdx = products.findIndex(p => p.id === targetId);

    if (sourceIdx === -1 || targetIdx === -1) return;

    const newProducts = [...products];
    const [draggedItem] = newProducts.splice(sourceIdx, 1);
    newProducts.splice(targetIdx, 0, draggedItem);

    setProducts(newProducts);
    setDraggedProdId(null);

    try {
      const res = await fetch("/api/products/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: newProducts.map(p => p.id) })
      });
      if (!res.ok) throw new Error("Failed to save reorder");
      
      // Re-fetch the full list (including unpublished) from the admin API
      // to ensure state is perfectly synced with the DB.
      const freshRes = await fetch("/api/products");
      if (freshRes.ok) {
        const all: ProductData[] = await freshRes.json();
        setProducts(all);
      }
      
      router.refresh();
    } catch (err) {
      console.error(err);
      setProducts(products); // Rollback optimistic UI
      showToast("ไม่สามารถบันทึกลำดับสินค้าได้", "error");
    }
  };

  const handleManualSort = async (itemId: string, newPosition: number) => {
    if (!canDrag) return;
    
    const validTargetIndex = Math.max(0, Math.min(newPosition - 1, filteredItems.length - 1));
    const targetItem = filteredItems[validTargetIndex];
    if (!targetItem || targetItem.id === itemId) return;

    const sourceIdx = products.findIndex(p => p.id === itemId);
    const targetIdx = products.findIndex(p => p.id === targetItem.id);

    if (sourceIdx === -1 || targetIdx === -1) return;

    const newProducts = [...products];
    const [draggedItem] = newProducts.splice(sourceIdx, 1);
    newProducts.splice(targetIdx, 0, draggedItem);

    setProducts(newProducts);

    try {
      const res = await fetch("/api/products/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: newProducts.map(p => p.id) })
      });
      if (!res.ok) throw new Error("Failed to save reorder");
      
      const freshRes = await fetch("/api/products");
      if (freshRes.ok) {
        const all: ProductData[] = await freshRes.json();
        setProducts(all);
      }
      
      router.refresh();
      showToast("จัดเรียงลำดับสำเร็จ", "success");
    } catch (err) {
      console.error(err);
      setProducts(products); // Rollback
      showToast("ไม่สามารถบันทึกลำดับสินค้าได้", "error");
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
      const data = await res.json();
      
      if (data.hardDeleted) {
        setProducts(products.filter(p => p.id !== id));
        showToast("ลบสินค้าถาวรเรียบร้อยแล้ว", "success");
      } else {
        setProducts(products.map(p => 
          p.id === id ? { ...p, isPublished: false, pendingDeleteAt: data.pendingDeleteAt } : p
        ));
        showToast("เปลี่ยนสินค้าเป็นสถานะรอยืนยันการลบแล้ว", "success");
      }
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

      const updatedPayload = { isPublished: newStatus };
      const res = await fetch(`/api/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPayload)
      });
      if (!res.ok) throw new Error("Failed to update status");

      const updatedItem = await res.json();
      setProducts(products.map(prod => prod.id === id ? updatedItem : prod));
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
    if (cat.id !== -1) {
      const productsInCat = products.filter(p => p.categoryId === cat.id);
      
      if (productsInCat.length > 0) {
        // If it has products, hide it if ALL of them are unpublished (but show for admins)
        if (!isLoggedIn) {
          const hasPublishedProduct = productsInCat.some(p => p.isPublished !== false);
          if (!hasPublishedProduct) return false;
        }
      } else {
        // If it has NO products, hide it for regular users, but show it for admins
        if (!isLoggedIn) return false;
      }
    }
    if (!searchCategory) return true;
    const s = searchCategory.toLowerCase();
    return stripHtml(cat.name_th || "").toLowerCase().includes(s) ||
           stripHtml(cat.name_en || "").toLowerCase().includes(s) ||
           stripHtml(cat.name_zh || "").toLowerCase().includes(s);
  });

  const filteredItems = visibleProducts.filter((item) => {
    const matchesCategory = selectedCategory === -1 || item.categoryId === selectedCategory;
    let matchesSearch = true;
    if (debouncedSearchProduct) {
      const s = debouncedSearchProduct.toLowerCase();
      matchesSearch = stripHtml(item.title_th || "").toLowerCase().includes(s) ||
                      stripHtml(item.title_en || "").toLowerCase().includes(s) ||
                      stripHtml(item.title_zh || "").toLowerCase().includes(s);
    }
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
        {pendingDeleteProd !== null && (() => {
          const productToDelete = products.find(p => p.id === pendingDeleteProd);
          const isAlreadyPending = productToDelete?.pendingDeleteAt != null;
          return (
            <ConfirmDialog
              message={isAlreadyPending 
                ? "คุณแน่ใจหรือไม่ที่จะลบสินค้านี้ถาวร?\n(ระบบจะลบรูปภาพและหน้าเนื้อหาทั้งหมดด้วยแบบกู้คืนไม่ได้)" 
                : "คุณแน่ใจหรือไม่ที่จะลบสินค้านี้?\n(สินค้าจะเปลี่ยนเป็นสถานะรอยืนยันการลบ และสามารถยกเลิกได้โดยการกดปุ่มรูปตา)"
              }
              onConfirm={handleDeleteProduct}
              onCancel={() => setPendingDeleteProd(null)}
              loading={deletingProd}
            />
          );
        })()}
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
                          <div className="flex flex-col gap-2 w-full mr-2" onClick={e => e.stopPropagation()}>
                            <div className="bg-white border rounded">
                              <RichTextEditor
                                value={editingCatName}
                                onChange={setEditingCatName}
                                placeholder="ชื่อหมวดหมู่..."
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleUpdateCategory(category.id)}
                                disabled={savingCat || !stripHtml(editingCatName).trim()}
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
                          </div>
                        ) : (
                          <span className="relative py-2 font-serif text-base md:text-lg tracking-wide inline-block whitespace-nowrap lg:whitespace-normal lg:break-words leading-tight">
                            <span dangerouslySetInnerHTML={{ __html: getCatName(category) }} className="[&_p]:inline [&_p]:m-0" />
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
              <div className="flex items-center w-full flex-1 gap-2 sm:ml-4">
                <div className="relative w-full flex-1">
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
                    const val = e.target.value;
                    setSearchProduct(val);
                    if (val.trim() !== "") {
                      setSelectedCategory(-1);
                    }
                    setCurrentPage(1);
                    ensureInputVisible(e.target);
                  }}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm"
                />
                </div>
                {isLoggedIn && (
                  <div className="flex items-center bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex-shrink-0 p-0.5">
                    <button
                      onClick={() => setViewMode("grid")}
                      className={`p-2 rounded-lg transition-colors ${viewMode === "grid" ? "bg-orange-50 text-orange-600" : "text-gray-400 hover:text-gray-600"}`}
                      aria-label="Grid View"
                      title="Grid View"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                    </button>
                    <button
                      onClick={() => setViewMode("table")}
                      className={`p-2 rounded-lg transition-colors ${viewMode === "table" ? "bg-orange-50 text-orange-600" : "text-gray-400 hover:text-gray-600"}`}
                      aria-label="Table View"
                      title="Table View"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 content-start">
              {paginatedItems.map((item, i) => {
                return (
                  <Link
                    key={`${selectedCategory}-${item.id}`}
                    href={`/showcase/product/${item.id}`}
                    draggable={canDrag}
                    onDragStart={(e) => handleProdDragStart(e, item.id)}
                    onDragEnter={(e) => handleProdDragEnter(e, item.id)}
                    onDragOver={(e) => {
                      if (!canDrag) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => handleProdDrop(e, item.id)}
                    onDragEnd={() => { dragEndTimeRef.current = Date.now(); setDraggedProdId(null); setDragOverProdId(null); }}
                    onClick={(e) => {
                      if (Date.now() - dragEndTimeRef.current < 200) { e.preventDefault(); return; }
                      setLoadingId(item.id);
                    }}
                    className={`group flex flex-col rounded-2xl border overflow-hidden transition-all duration-300 ${loadingId === item.id ? "cursor-wait opacity-80 scale-[0.98]" : "cursor-pointer"} ${item.isPublished === false ? "opacity-75 bg-gray-50 border-gray-200 grayscale-[0.5]" : "bg-white border-gray-100 hover:border-gray-200 hover:shadow-xl hover:shadow-black/[0.04]"} ${dragOverProdId === item.id ? "border-orange-400 shadow-lg scale-[1.02]" : ""} ${draggedProdId === item.id ? "opacity-30 scale-95" : ""}`}
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div className={`relative aspect-[4/3] sm:aspect-square overflow-hidden border-b border-gray-50 ${item.isPublished === false ? "bg-gray-100" : "bg-white"}`}>
                      <Image
                        src={item.image}
                        alt={stripHtml(getTitle(item))}
                        fill
                        sizes="(max-width: 1024px) 100vw, 30vw"
                        className={`object-contain p-8 transition-transform duration-700 ease-out ${item.isPublished === false ? "grayscale opacity-80 mix-blend-multiply" : "group-hover:scale-105"}`}
                      />
                      <div className={`absolute inset-0 bg-black/0 transition-colors duration-500 ${item.isPublished === false ? "" : "group-hover:bg-black/[0.02]"}`} />
                      
                      {item.pendingDeleteAt && (
                        <div className="absolute top-4 left-4 z-20">
                          <span className="px-3 py-1 bg-red-500 text-white text-xs font-bold rounded-full shadow-lg shadow-red-500/30">
                            รอยืนยันการลบ
                          </span>
                        </div>
                      )}

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
                            aria-label={item.isPublished !== false ? "ซ่อนสินค้า" : "เผยแพร่สินค้า / ยกเลิกการลบ"}
                            title={item.isPublished !== false ? "ซ่อนสินค้า" : "เผยแพร่สินค้า / ยกเลิกการลบ"}
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
                            aria-label={item.pendingDeleteAt ? "ลบถาวรทันที" : "ลบสินค้า"}
                            title={item.pendingDeleteAt ? "ลบถาวรทันที" : "ลบสินค้า"}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className={`flex flex-col flex-1 p-6 relative z-10 ${item.isPublished === false ? "bg-gray-50" : "bg-white"}`}>
                      <h3 
                        className={`text-lg font-bold text-[var(--text-primary)] mb-1 transition-colors line-clamp-2 [&_p]:inline [&_p]:m-0 ${item.isPublished === false ? "" : "group-hover:text-[var(--accent)]"}`}
                        dangerouslySetInnerHTML={{ __html: getTitle(item) }}
                      />
                      {/* Show the English name too when viewing another language:
                          Thai B2B buyers search equipment by its English name, so
                          keeping it in the (crawlable) markup helps those searches. */}
                      {lang !== "en" && item.title_en && item.title_en !== getTitle(item) && (
                        <div 
                          className="text-xs font-medium text-gray-400 mb-2 line-clamp-1 [&_p]:inline [&_p]:m-0"
                          dangerouslySetInnerHTML={{ __html: item.title_en }}
                        />
                      )}
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
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap min-w-[700px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-sm">
                      <th className="py-3 px-4 w-12 text-center"></th>
                      <th className="py-3 px-4 w-16">รูปภาพ</th>
                      <th className="py-3 px-4">ชื่อสินค้า</th>
                      <th className="py-3 px-4">หมวดหมู่</th>
                      <th className="py-3 px-4 w-28">สถานะ</th>
                      <th className="py-3 px-4 w-28 text-right">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => {
                      const cat = allCategories.find(c => c.id === item.categoryId);
                      return (
                        <tr
                          key={item.id}
                          draggable={canDrag}
                          onDragStart={(e) => handleProdDragStart(e, item.id)}
                          onDragEnter={(e) => handleProdDragEnter(e, item.id)}
                          onDragOver={(e) => {
                            if (!canDrag) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(e) => handleProdDrop(e, item.id)}
                          onDragEnd={() => { dragEndTimeRef.current = Date.now(); setDraggedProdId(null); setDragOverProdId(null); }}
                          onClick={(e) => {
                            if (Date.now() - dragEndTimeRef.current < 200) { e.preventDefault(); return; }
                            setLoadingId(item.id);
                            router.push(`/edit-product/${item.id}`);
                          }}
                          className={`cursor-pointer hover:bg-gray-50/50 transition-colors border-b border-gray-50 last:border-0 ${dragOverProdId === item.id ? (draggedProdId && products.findIndex(p => p.id === draggedProdId) < products.findIndex(p => p.id === item.id) ? "border-b-2 border-b-orange-400" : "border-t-2 border-t-orange-400") : ""} ${draggedProdId === item.id ? "opacity-30 bg-gray-50" : ""} ${loadingId === item.id ? "opacity-50" : ""}`}
                        >
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            {isLoggedIn && (
                              <div className="flex items-center justify-center gap-2">
                                <svg className="w-5 h-5 text-gray-300 cursor-grab active:cursor-grabbing inline-block hover:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" /></svg>
                                {canDrag && (
                                  <SortInput
                                    key={item.id}
                                    initialValue={filteredItems.findIndex(p => p.id === item.id) + 1}
                                    max={filteredItems.length}
                                    onConfirm={(val) => handleManualSort(item.id, val)}
                                  />
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-4">
                            <div className="relative w-12 h-12 rounded bg-gray-50 overflow-hidden border border-gray-100 flex-shrink-0">
                              <Image src={item.image} alt={stripHtml(getTitle(item))} fill sizes="48px" className={`object-contain p-1 ${item.isPublished === false ? "grayscale opacity-70" : ""}`} />
                            </div>
                          </td>
                          <td className="py-3 px-4 min-w-[200px] whitespace-normal">
                            <div className={`font-bold line-clamp-2 ${item.isPublished === false ? "text-gray-400" : "text-gray-800"}`} dangerouslySetInnerHTML={{ __html: getTitle(item) }} />
                            {item.pendingDeleteAt && (
                              <span className="inline-block mt-1 px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full">รอยืนยันการลบ</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-500 max-w-[150px] truncate">
                            {cat ? <span dangerouslySetInnerHTML={{ __html: getCatName(cat) }} /> : "Unknown"}
                          </td>
                          <td className="py-3 px-4">
                            {item.isPublished !== false ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-600 text-xs font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> เผยแพร่
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span> ซ่อน
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                             <div className="flex items-center justify-end gap-1">
                                {isLoggedIn && (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleTogglePublish(item.id, item.isPublished !== false);
                                      }}
                                      disabled={publishTogglingId === item.id}
                                      className={`p-1.5 rounded-lg transition-colors ${item.isPublished !== false ? "text-green-600 hover:bg-green-50" : "text-gray-400 hover:bg-gray-100"}`}
                                      title={item.isPublished !== false ? "ซ่อนสินค้า" : "เผยแพร่สินค้า"}
                                    >
                                      {publishTogglingId === item.id ? (
                                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                                      ) : item.isPublished !== false ? (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                      ) : (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                      )}
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setPendingDeleteProd(item.id);
                                      }}
                                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                      title="ลบสินค้า"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                  </>
                                )}
                             </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

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
