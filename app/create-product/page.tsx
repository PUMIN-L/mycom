"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import RichTextEditor from "../components/RichTextEditor";
import Toast from "../components/Toast";
import ErrorModal from "../components/ErrorModal";
import MultiSelectDropdown from "../components/MultiSelectDropdown";
import SearchableDropdown from "../components/SearchableDropdown";
import type { SearchableDropdownOption } from "../components/SearchableDropdown";
import { stripHtml } from "../lib/stripHtml";
import { useLeaveGuard } from "../components/LeaveGuard";

interface ProductCategory {
  id: number;
  name_th: string;
  name_en: string;
  name_zh: string;
  sortOrder: number;
}

export default function CreateProduct() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);

  const [titleTh, setTitleTh] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleZh, setTitleZh] = useState("");
  const [descTh, setDescTh] = useState("");
  const [descEn, setDescEn] = useState("");
  const [descZh, setDescZh] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | "new">(0);
  const [newCatTh, setNewCatTh] = useState("");
  const [newCatEn, setNewCatEn] = useState("");
  const [newCatZh, setNewCatZh] = useState("");
  const [bestSellerRank, setBestSellerRank] = useState<number | "">("");
  const [showBestSellerBadge, setShowBestSellerBadge] = useState<boolean>(true);
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [errorModal, setErrorModal] = useState<{ isOpen: boolean; title?: string; message: string }>({
    isOpen: false,
    message: ""
  });

  // ── Unsaved-changes guard (beforeunload only — no nav Links on this page) ──
  const formData = { titleTh, titleEn, titleZh, descTh, descEn, descZh, imageUrl, selectedCategoryId, selectedSupplierIds, bestSellerRank };
  useLeaveGuard(formData);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    // Clear the previous auto-dismiss so an earlier toast's timer can't hide a
    // newer toast fired within the 3s window.
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading]);

  // Fetch categories and suppliers
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [catRes, supRes, prodRes] = await Promise.all([
          fetch("/api/products/categories"),
          fetch("/api/suppliers"),
          fetch("/api/products")
        ]);
        if (catRes.ok) {
          const data = await catRes.json();
          setCategories(data);
          if (data.length > 0) setSelectedCategoryId(data[0].id);
        }
        if (supRes.ok) {
          const supData = await supRes.json();
          setSuppliers(supData);
        }
        if (prodRes.ok) {
          const prodData = await prodRes.json();
          setAllProducts(prodData);
        }
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setLoadingCategories(false);
      }
    };
    fetchData();
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to upload image");

      const data = await response.json();
      setImageUrl(data.url);
      setImagePreview(data.url);
    } catch (error) {
      showToast("Error uploading image. Please try again.", "error");
      console.error(error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    if (!stripHtml(titleTh).trim() && !stripHtml(titleEn).trim()) {
      showToast("กรุณากรอกชื่อสินค้าอย่างน้อย 1 ภาษา", "error");
      return;
    }
    if (!imageUrl) {
      showToast("กรุณาอัปโหลดรูปภาพสินค้า", "error");
      return;
    }

    if (stripHtml(titleTh).length > 255 || stripHtml(titleEn).length > 255 || stripHtml(titleZh).length > 255) {
      setErrorModal({ isOpen: true, message: "ชื่อสินค้าต้องมีความยาวไม่เกิน 255 ตัวอักษร" });
      return;
    }
    if (stripHtml(descTh).length > 10000 || stripHtml(descEn).length > 10000 || stripHtml(descZh).length > 10000) {
      setErrorModal({ isOpen: true, message: "รายละเอียดสินค้าต้องมีความยาวไม่เกิน 10,000 ตัวอักษร" });
      return;
    }

    setIsSubmitting(true);

    try {
      let finalCategoryId = selectedCategoryId;

      // 1. Create new category if selected
      if (selectedCategoryId === "new") {
        if (!newCatTh.trim() || !newCatEn.trim()) {
          throw new Error("กรุณากรอกชื่อหมวดหมู่ใหม่ให้ครบถ้วน (อย่างน้อยไทยและอังกฤษ)");
        }
        
        const catRes = await fetch("/api/products/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name_th: newCatTh,
            name_en: newCatEn,
            name_zh: newCatZh || newCatEn,
          }),
        });

        if (!catRes.ok) {
          throw new Error("Failed to create new category");
        }

        const newCat = await catRes.json();
        finalCategoryId = newCat.id;
      }

      // 2. Create the product
      const productData = {
        id: crypto.randomUUID(),
        categoryId: finalCategoryId,
        image: imageUrl,
        title_th: titleTh || titleEn,
        title_en: titleEn || titleTh,
        title_zh: titleZh || titleEn || titleTh,
        desc_th: descTh,
        desc_en: descEn,
        desc_zh: descZh,
        createdAt: new Date().toISOString(),
        supplierIds: selectedSupplierIds,
        bestSellerRank: bestSellerRank === "" ? null : Number(bestSellerRank),
        showBestSellerBadge: showBestSellerBadge,
      };
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(productData),
      });

      if (!response.ok) {
        let errMsg = "Failed to save product";
        try {
          const errData = await response.json();
          if (errData.details) errMsg += ` (${errData.details})`;
        } catch (_) {}
        throw new Error(errMsg);
      }

      router.push("/#products");
    } catch (error: any) {
      setErrorModal({ isOpen: true, message: error.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง" });
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <svg className="animate-spin h-10 w-10 text-orange-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  // ── Category dropdown options ─────────────────────────────────────────────
  // Same list, same order as the <select> this replaced: every category, then
  // "+ เพิ่มหมวดหมู่ใหม่..." last. `stripHtml` because the names are authored in
  // RichTextEditor, exactly as the old <option> bodies did it.
  const categoryOptions: SearchableDropdownOption[] = [
    ...categories.map((cat) => ({
      value: String(cat.id),
      label: `${stripHtml(cat.name_th)} / ${stripHtml(cat.name_en)}`,
    })),
    { value: "new", label: "+ เพิ่มหมวดหมู่ใหม่..." },
  ];
  /**
   * A selected category may not be in the list (deleted, or the categories
   * fetch failed). SearchableDropdown shows its placeholder for a value it has
   * no option for, which would read as "nothing chosen" and hide the link the
   * form still carries into the save. Prepending a synthetic option keeps it
   * visible and labelled — same trick as `app/customers/EquipmentTab.tsx`
   * (~line 279). Kept identical to `edit-product/[id]/page.tsx`, where a
   * product loaded with a since-deleted categoryId hits this for real.
   */
  if (
    typeof selectedCategoryId === "number" &&
    selectedCategoryId > 0 &&
    !categories.some((cat) => cat.id === selectedCategoryId)
  ) {
    categoryOptions.unshift({
      value: String(selectedCategoryId),
      label: `หมวดหมู่เดิม (#${selectedCategoryId})`,
      subLabel: "ไม่พบในรายการหมวดหมู่ปัจจุบัน",
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-4xl font-bold mb-2 text-gray-900">สร้างสินค้าใหม่</h1>
        <p className="text-gray-600 mb-8">
          Create a new product — กรอกข้อมูลสินค้าและอัปโหลดรูปภาพ
        </p>

        {/* Category Selector */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-2 text-gray-700">
            📁 หมวดหมู่สินค้า
          </label>
          {loadingCategories ? (
            <div className="text-gray-400 text-sm">กำลังโหลดหมวดหมู่...</div>
          ) : (
            <div className="space-y-4">
              {/* Every dropdown in this project is `SearchableDropdown`, never a
                  native <select> (AGENTS.md, ARCHITECTURE.md §11): the OPERATING
                  SYSTEM paints a native one, so on a dark-mode machine it opens
                  as a dark grey popup in the middle of this white form. The
                  search box stays (`searchable` defaults true) — the category
                  list is admin-editable from this very control and grows.
                  buttonClassName restates the old <select>'s px-4 py-2, base
                  text size and orange focus ring so the box, height and spacing
                  are unchanged. No validation is lost in the swap: the <select>
                  carried no `required` and no `:invalid` styling, and the only
                  save-time check this control feeds — the newCatTh/newCatEn
                  guard for the "new" branch in `handleSubmit` — is untouched. */}
              <SearchableDropdown
                options={categoryOptions}
                value={String(selectedCategoryId)}
                onChange={(val) => {
                  setSelectedCategoryId(val === "new" ? "new" : Number(val));
                }}
                placeholder="เลือกหมวดหมู่..."
                buttonClassName="px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-orange-500"
              />

              {/* New Category Inputs */}
              {selectedCategoryId === "new" && (
                <div className="p-4 bg-orange-50 border border-orange-100 rounded-lg space-y-3">
                  <p className="text-sm font-semibold text-orange-800">สร้างหมวดหมู่ใหม่</p>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">🇹🇭 ภาษาไทย</label>
                    <RichTextEditor
                      value={newCatTh}
                      onChange={setNewCatTh}
                      placeholder="ชื่อหมวดหมู่ภาษาไทย..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">🇬🇧 English</label>
                    <RichTextEditor
                      value={newCatEn}
                      onChange={setNewCatEn}
                      placeholder="Category name in English..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">🇨🇳 中文</label>
                    <RichTextEditor
                      value={newCatZh}
                      onChange={setNewCatZh}
                      placeholder="分类名称..."
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Suppliers Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">🤝 ผู้ผลิตสินค้า (Suppliers)</h2>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-gray-500 mb-1">เลือกผู้ผลิต (เลือกได้มากกว่า 1)</label>
            {suppliers.length === 0 ? (
              <p className="text-sm text-gray-500">ไม่มีข้อมูลผู้ผลิต</p>
            ) : (
              <MultiSelectDropdown
                options={suppliers.map(sup => ({
                  value: sup.id,
                  label: sup.companyName
                }))}
                values={selectedSupplierIds}
                onChange={setSelectedSupplierIds}
                placeholder="เลือกผู้ผลิตสินค้า..."
              />
            )}
          </div>
        </div>

        {/* Product Image */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-2 text-gray-700">
            🖼️ รูปภาพสินค้า
          </label>
          <div className="flex flex-col items-center gap-4">
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="max-w-full max-h-80 rounded-lg border border-gray-200"
                />
                <button
                  onClick={() => {
                    setImageUrl("");
                    setImagePreview("");
                  }}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500 text-white hover:bg-red-600 flex items-center justify-center text-sm font-bold shadow"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-48 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-orange-400 hover:bg-orange-50 transition"
              >
                {isUploading ? (
                  <>
                    <svg className="animate-spin h-8 w-8 text-orange-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-gray-500 font-medium">กำลังอัปโหลด...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-gray-500 font-medium">คลิกเพื่ออัปโหลดรูปภาพ</span>
                    <span className="text-gray-400 text-xs">PNG, JPG, WEBP</span>
                  </>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Best Seller Inputs */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-4 text-gray-700">
            🌟 สินค้าขายดี (Best Seller)
          </label>
          <div className="flex flex-col sm:flex-row gap-6 sm:items-center">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">อันดับ Best Seller</label>
              <SearchableDropdown
                options={[
                  { value: "", label: "ไม่มีลำดับ", subLabel: "ไม่เป็นสินค้าขายดี" },
                  ...Array.from({ length: 50 }, (_, i) => {
                    const rank = i + 1;
                    const existing = allProducts.find(p => p.bestSellerRank === rank);
                    return {
                      value: String(rank),
                      label: `อันดับ ${rank}`,
                      subLabel: existing ? `ใช้งานอยู่โดย: ${stripHtml(existing.title_th || existing.title_en || "ไม่มีชื่อ")}` : "ว่าง",
                      disabled: !!existing
                    };
                  })
                ]}
                value={bestSellerRank === "" ? "" : String(bestSellerRank)}
                onChange={(val) => setBestSellerRank(val === "" ? "" : Number(val))}
                placeholder="เลือกอันดับ..."
                className="w-56"
              />
            </div>
            
            <div className="flex items-center gap-2 mt-2 sm:mt-0 pt-2 sm:pt-4">
              <input
                type="checkbox"
                id="showBadge"
                checked={showBestSellerBadge}
                onChange={(e) => setShowBestSellerBadge(e.target.checked)}
                className="w-5 h-5 text-orange-500 border-gray-300 rounded focus:ring-orange-500"
              />
              <label htmlFor="showBadge" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                แสดงป้าย Best Seller 🌟
              </label>
            </div>
          </div>
        </div>

        {/* Title Inputs */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-4 text-gray-700">
            📝 ชื่อสินค้า
          </label>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">🇹🇭 ภาษาไทย</label>
              <RichTextEditor
                value={titleTh}
                onChange={setTitleTh}
                placeholder="ชื่อสินค้าภาษาไทย..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">🇬🇧 English</label>
              <RichTextEditor
                value={titleEn}
                onChange={setTitleEn}
                placeholder="Product name in English..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">🇨🇳 中文</label>
              <RichTextEditor
                value={titleZh}
                onChange={setTitleZh}
                placeholder="产品名称..."
              />
            </div>
          </div>
        </div>

        {/* Description Inputs */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-4 text-gray-700">
            📋 รายละเอียดสินค้า
          </label>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">🇹🇭 ภาษาไทย</label>
              <RichTextEditor
                value={descTh}
                onChange={setDescTh}
                placeholder="รายละเอียดสินค้าภาษาไทย..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">🇬🇧 English</label>
              <RichTextEditor
                value={descEn}
                onChange={setDescEn}
                placeholder="Product description in English..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">🇨🇳 中文</label>
              <RichTextEditor
                value={descZh}
                onChange={setDescZh}
                placeholder="产品描述..."
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full px-8 py-4 bg-orange-500 text-white font-bold text-lg rounded-lg hover:bg-orange-600 transition disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              กำลังบันทึก...
            </>
          ) : (
            "📦 เผยแพร่สินค้า"
          )}
        </button>

        {/* Back Link */}
        <div className="mt-4 text-center">
          <a href="/" className="text-gray-600 hover:text-gray-900">
            ← กลับหน้าแรก
          </a>
        </div>
      </div>

      <ErrorModal
        isOpen={errorModal.isOpen}
        title={errorModal.title}
        message={errorModal.message}
        onClose={() => setErrorModal({ ...errorModal, isOpen: false })}
      />
    </div>
  );
}
