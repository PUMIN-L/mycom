"use client";
import { useState, useRef, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import RichTextEditor from "../../components/RichTextEditor";
import Toast from "../../components/Toast";
import ErrorModal from "../../components/ErrorModal";
import { stripHtml } from "../../lib/stripHtml";

interface ProductCategory {
  id: number;
  name_th: string;
  name_en: string;
  name_zh: string;
  sortOrder: number;
}

export default function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Unwrap params using `use()`
  const resolvedParams = use(params);
  const productId = resolvedParams.id;

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [loadingProduct, setLoadingProduct] = useState(true);

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
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [errorModal, setErrorModal] = useState<{ isOpen: boolean; title?: string; message: string }>({
    isOpen: false,
    message: ""
  });

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
  }, [isLoggedIn, isLoading, router]);

  // Fetch categories and suppliers
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [catRes, supRes] = await Promise.all([
          fetch("/api/products/categories"),
          fetch("/api/suppliers")
        ]);
        if (catRes.ok) {
          const data = await catRes.json();
          setCategories(data);
        }
        if (supRes.ok) {
          const supData = await supRes.json();
          setSuppliers(supData);
        }
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setLoadingCategories(false);
      }
    };
    fetchData();
  }, []);

  // Fetch product data
  useEffect(() => {
    const fetchProduct = async () => {
      if (!productId) return;
      try {
        const res = await fetch(`/api/products/${productId}`);
        if (!res.ok) {
          throw new Error("Product not found");
        }
        const data = await res.json();
        setTitleTh(data.title_th || "");
        setTitleEn(data.title_en || "");
        setTitleZh(data.title_zh || "");
        setDescTh(data.desc_th || "");
        setDescEn(data.desc_en || "");
        setDescZh(data.desc_zh || "");
        setSelectedCategoryId(data.categoryId);
        setImageUrl(data.image || "");
        setImagePreview(data.image || "");
        setSelectedSupplierIds(data.supplierIds || []);
      } catch (err) {
        console.error("Error fetching product:", err);
        showToast("ไม่พบข้อมูลสินค้า", "error");
        router.push("/#products");
      } finally {
        setLoadingProduct(false);
      }
    };
    fetchProduct();
  }, [productId, router]);

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

      // 2. Update the product
      const productData = {
        categoryId: finalCategoryId,
        image: imageUrl,
        title_th: titleTh || titleEn,
        title_en: titleEn || titleTh,
        title_zh: titleZh || titleEn || titleTh,
        desc_th: descTh,
        desc_en: descEn,
        desc_zh: descZh,
        supplierIds: selectedSupplierIds,
      };
      
      const response = await fetch(`/api/products/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(productData),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to update product");
      }

      showToast("บันทึกการแก้ไขสำเร็จ", "success");
      setTimeout(() => {
        router.push("/#products");
      }, 1000);
    } catch (error: any) {
      console.error(error);
      setErrorModal({ isOpen: true, message: error.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || loadingProduct) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <svg className="animate-spin h-10 w-10 text-orange-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <main className="max-w-4xl mx-auto px-4">
        <h1 className="text-4xl font-bold mb-2 text-gray-900">แก้ไขสินค้า</h1>
        <p className="text-gray-600 mb-8">
          Edit product — แก้ไขข้อมูลสินค้าและอัปเดตรูปภาพ
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
              <select
                value={selectedCategoryId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedCategoryId(val === "new" ? "new" : Number(val));
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {stripHtml(cat.name_th)} / {stripHtml(cat.name_en)}
                  </option>
                ))}
                <option value="new" className="font-bold text-orange-600">
                  + เพิ่มหมวดหมู่ใหม่...
                </option>
              </select>

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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6 mb-6">
          <h2 className="text-xl font-bold text-gray-800 border-b border-gray-100 pb-4">ผู้ผลิตสินค้า (Suppliers)</h2>
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-gray-700">เลือกผู้ผลิต (เลือกได้มากกว่า 1)</label>
            {suppliers.length === 0 ? (
              <p className="text-sm text-gray-500">ไม่มีข้อมูลผู้ผลิต</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {suppliers.map((sup) => (
                  <label key={sup.id} className="flex items-center gap-3 p-3 border rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                      checked={selectedSupplierIds.includes(sup.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSupplierIds([...selectedSupplierIds, sup.id]);
                        } else {
                          setSelectedSupplierIds(selectedSupplierIds.filter(id => id !== sup.id));
                        }
                      }}
                    />
                    <span className="text-sm text-gray-800 font-medium">{sup.companyName}</span>
                  </label>
                ))}
              </div>
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
                {/* We use next/image or standard img for preview. Using img for blob/external url consistency here */}
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
                    <span className="text-gray-500 font-medium">คลิกเพื่ออัปโหลดรูปภาพใหม่</span>
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
            "💾 บันทึกการแก้ไข"
          )}
        </button>

        {/* Back Link */}
        <div className="mt-4 text-center">
          <a href="/#products" className="text-gray-600 hover:text-gray-900">
            ← กลับหน้าแรก
          </a>
        </div>
      </main>

      <ErrorModal
        isOpen={errorModal.isOpen}
        title={errorModal.title}
        message={errorModal.message}
        onClose={() => setErrorModal({ ...errorModal, isOpen: false })}
      />
    </div>
  );
}
