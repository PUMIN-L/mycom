"use client";
import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import ColorPickerDropdown from "../components/ColorPickerDropdown";
import SearchableDropdown from "../components/SearchableDropdown";
import type { SearchableDropdownOption } from "../components/SearchableDropdown";
import RichTextEditor from "../components/RichTextEditor";
import BlockRangeControl from "../components/BlockRangeControl";
import Toast from "../components/Toast";
import ErrorModal from "../components/ErrorModal";
import { stripHtml } from "../lib/stripHtml";
import { useLeaveGuard, LeaveGuardModal } from "../components/LeaveGuard";
import YoutubeEmbed from "../components/YoutubeEmbed";
import type { ContentBlock } from "../lib/types";

interface ProductCategory {
  id: number;
  name_th: string;
  name_en: string;
  name_zh: string;
}

interface ProductItem {
  id: string;
  categoryId: number;
  title_th: string;
  title_en: string;
  title_zh: string;
}

/**
 * PROJECT RULE — every dropdown on this page is `SearchableDropdown`, never a
 * native `<select>` (AGENTS.md / ARCHITECTURE.md §11). A native one is painted
 * by the OPERATING SYSTEM, so on a dark-mode machine it opens as a dark grey
 * popup in the middle of this white form.
 *
 * Two fixed options, so `searchable={false}` — a search box over two rows is
 * dead weight. The values stay the exact strings `ContentBlock.imagePosition`
 * has always held ("left" / "right"), because they are written straight into
 * the blocks JSON that both this page and `/showcase/[id]` save.
 *
 * The twin of this control lives in `app/showcase/[id]/ShowcaseClient.tsx`
 * (the in-place editor of the same blocks) and must stay identical to it.
 */
const IMAGE_POSITION_OPTIONS: SearchableDropdownOption[] = [
  { value: "right", label: "รูปอยู่ขวา" },
  { value: "left", label: "รูปอยู่ซ้าย" },
];

/** The unpicked state of the product dropdown. Kept as a real (disabled) option
 * rather than only a placeholder so it renders in the list exactly like the
 * native `<option value="" disabled>` it replaces: visible, never re-selectable
 * once a product has been chosen. */
const PRODUCT_PLACEHOLDER = "-- กรุณาเลือก Product --";

function CreateContentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn, isLoading } = useAuth();
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [title, setTitle] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string>(
    searchParams.get("productId") ?? ""
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [replacingBlockId, setReplacingBlockId] = useState<string | null>(null);
  const [galleryUploadingId, setGalleryUploadingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [errorModal, setErrorModal] = useState<{ isOpen: boolean; title?: string; message: string }>({
    isOpen: false,
    message: ""
  });

  // ── Unsaved-changes guard ──
  const formData = { title, blocks, selectedProductId };
  const { guardedNavigate, setSnapshot, showModal, confirmLeave, cancelLeave, setShowModal } = useLeaveGuard(formData);

  // Products from API
  const [allProducts, setAllProducts] = useState<ProductItem[]>([]);
  const [allCategories, setAllCategories] = useState<ProductCategory[]>([]);
  const [linkedProductIds, setLinkedProductIds] = useState<Set<string>>(new Set());

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.replace("/login");
    }
  }, [isLoggedIn, isLoading]);

  // Fetch products and categories from API
  useEffect(() => {
    const fetchProductsAndContents = async () => {
      try {
        const [prodRes, catRes, contRes] = await Promise.all([
          fetch("/api/products"),
          fetch("/api/products/categories"),
          fetch("/api/contents/all"),
        ]);
        if (prodRes.ok) setAllProducts(await prodRes.json());
        if (catRes.ok) setAllCategories(await catRes.json());
        if (contRes.ok) {
          const allContents = await contRes.json();
          const linkedIds = new Set<string>();
          allContents.forEach((c: any) => {
            if (c.productId) linkedIds.add(c.productId);
          });
          setLinkedProductIds(linkedIds);
        }
      } catch (err) {
        console.error("Error fetching data:", err);
      }
    };
    fetchProductsAndContents();
  }, []);

  /**
   * The product list, flattened for `SearchableDropdown`.
   *
   * `SearchableDropdown` has no `<optgroup>`, so the category that used to be
   * the group heading becomes each row's `subLabel` — the products keep the
   * exact same ORDER (category by category, products in API order within a
   * category), the same values (`p.id`, "" for the unpicked state), the same
   * disabled rows and the same label text as the native `<select>` had. A
   * product whose categoryId matches no category is left out, exactly as the
   * `<optgroup>` version left it out.
   */
  const productOptions = useMemo<SearchableDropdownOption[]>(() => {
    // The product this page was opened for (?productId=…) stays selectable even
    // when it is already linked — same exception the native <option> made.
    const preselectedProductId = searchParams.get("productId");
    return [
      { value: "", label: PRODUCT_PLACEHOLDER, disabled: true },
      ...allCategories.flatMap((cat) =>
        allProducts
          .filter((p) => p.categoryId === cat.id)
          .map((p) => {
            const isLinked = linkedProductIds.has(p.id);
            return {
              value: p.id,
              label: isLinked
                ? `${p.title_en} (มี Content แล้ว - ต้องลบของเก่าก่อน)`
                : p.title_en,
              subLabel: cat.name_en,
              disabled: isLinked && p.id !== preselectedProductId,
            };
          })
      ),
    ];
  }, [allCategories, allProducts, linkedProductIds, searchParams]);

  const addTextBlock = () => {
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      type: "text",
      content: "Edit this text",
      fontSize: "16",
      fontWeight: "400",
      textAlign: "left",
      textColor: "#000000",
    };
    setBlocks((prev) => [...prev, newBlock]);
    scrollToBlock(newBlock.id);
  };

  const scrollToBlock = (id: string) => {
    setTimeout(() => {
      document.getElementById(`block-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    // Clear the previous auto-dismiss so an earlier toast's timer can't hide a
    // newer toast fired within the 3s window.
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  const addImageBlock = () => {
    fileInputRef.current?.click();
  };

  const addTextImageBlock = () => {
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      type: "text-image",
      content: "Edit this text",
      imageUrl: "",
      imagePosition: "right",
      fontSize: "16",
      fontWeight: "400",
      textAlign: "left",
      textColor: "#000000",
    };
    setBlocks((prev) => [...prev, newBlock]);
    scrollToBlock(newBlock.id);
  };

  const addGalleryBlock = () => {
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      type: "gallery",
      imageUrls: [],
      selectedImageIndex: 0,
    };
    setBlocks((prev) => [...prev, newBlock]);
    scrollToBlock(newBlock.id);
  };

  const addYoutubeBlock = () => {
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      type: "youtube",
      youtubeUrl: "",
    };
    setBlocks((prev) => [...prev, newBlock]);
    scrollToBlock(newBlock.id);
  };

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

      if (!response.ok) {
        throw new Error("Failed to upload image");
      }

      const data = await response.json();
      const newBlock: ContentBlock = {
        id: crypto.randomUUID(),
        type: "image",
        imageUrl: data.url,
      };
      setBlocks((prev) => [...prev, newBlock]);
      scrollToBlock(newBlock.id);
    } catch (error) {
      showToast("Error uploading image. Please try again.", "error");
      console.error(error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleReplaceImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replacingBlockId) return;

    setUploadingBlockId(replacingBlockId);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      if (!response.ok) throw new Error("Failed to upload image");
      const data = await response.json();
      updateBlock(replacingBlockId, { imageUrl: data.url });
    } catch (error) {
      showToast("Error uploading image", "error");
      console.error(error);
    } finally {
      setUploadingBlockId(null);
      setReplacingBlockId(null);
      if (replaceImageInputRef.current) {
        replaceImageInputRef.current.value = "";
      }
    }
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !galleryUploadingId) return;

    const block = blocks.find(b => b.id === galleryUploadingId);
    if (!block) return;

    const currentCount = block.imageUrls?.length || 0;
    const filesArray = Array.from(files);
    
    if (currentCount + filesArray.length > 10) {
      showToast("สามารถเพิ่มรูปได้ไม่เกิน 10 รูป", "error");
      return;
    }

    setUploadingBlockId(galleryUploadingId);

    try {
      const uploadPromises = filesArray.map(async (file) => {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        return data.url;
      });

      const uploadedUrls = await Promise.all(uploadPromises);
      
      setBlocks(prev => prev.map(b => {
        if (b.id === galleryUploadingId) {
          return {
            ...b,
            imageUrls: [...(b.imageUrls || []), ...uploadedUrls]
          };
        }
        return b;
      }));
    } catch (error) {
      showToast("Error uploading images", "error");
      console.error(error);
    } finally {
      setUploadingBlockId(null);
      setGalleryUploadingId(null);
      if (galleryInputRef.current) {
        galleryInputRef.current.value = "";
      }
    }
  };

  // All block mutators use the functional setState form so async callbacks
  // (e.g. image upload completing) always merge into the LATEST blocks instead
  // of a stale snapshot — otherwise text typed during an upload gets wiped.
  const updateBlock = (id: string, updates: Partial<ContentBlock>) => {
    setBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, ...updates } : block))
    );
  };

  const deleteBlock = (id: string) => {
    setBlocks((prev) => prev.filter((block) => block.id !== id));
  };

  const moveBlock = (id: string, direction: "up" | "down") => {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (
        (direction === "up" && index > 0) ||
        (direction === "down" && index < prev.length - 1)
      ) {
        const newBlocks = [...prev];
        const swapIndex = direction === "up" ? index - 1 : index + 1;
        [newBlocks[index], newBlocks[swapIndex]] = [
          newBlocks[swapIndex],
          newBlocks[index],
        ];
        return newBlocks;
      }
      return prev;
    });
  };

  const handleSubmit = async () => {
    if (!stripHtml(title).trim()) {
      showToast("Please enter a title", "error");
      return;
    }
    if (stripHtml(title).length > 255) {
      setErrorModal({ isOpen: true, message: "หัวข้อคอนเทนต์ต้องมีความยาวไม่เกิน 255 ตัวอักษร" });
      return;
    }
    if (blocks.length === 0) {
      showToast("Please add at least one content block", "error");
      return;
    }

    const contentData = {
      id: crypto.randomUUID(),
      title,
      blocks,
      createdAt: new Date().toISOString(),
      productId: selectedProductId || null,
    };

    try {
      // Save to API
      const response = await fetch("/api/contents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(contentData),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save content");
      }

      // Redirect to showcase page
      setSnapshot();
      router.push(`/showcase/${contentData.id}`);
    } catch (error: any) {
      console.error(error);
      setErrorModal({ isOpen: true, message: error.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง" });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      {toast && <Toast message={toast.message} type={toast.type} />}
      <LeaveGuardModal
        show={showModal}
        onSave={async () => { setShowModal(false); await handleSubmit(); }}
        onDiscard={confirmLeave}
        onCancel={cancelLeave}
        documentLabel="เนื้อหา"
      />
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-gray-900">Create Content</h1>
            <p className="text-gray-600">
              Build your content by adding text and images
            </p>
          </div>
          <button
            type="button"
            onClick={() => guardedNavigate("/adminpanel")}
            className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition shadow-sm self-start sm:self-auto flex items-center gap-1.5 text-sm"
          >
            🏠 กลับไปหน้าระบบจัดการ
          </button>
        </div>

        {/* Title Input */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-2 text-gray-700">
            Content Title
          </label>
          <div className="w-full bg-white border border-gray-200 rounded">
            <RichTextEditor
              value={title}
              onChange={setTitle}
              placeholder="Enter your content title..."
            />
          </div>
        </div>

        {/* Product Selector */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-2 text-gray-700">
            ผูกกับ Product (จำเป็น)
          </label>
          {/* Searchable: the catalog is long, so the search box earns its place
              here (unlike the two-option image-position control below). */}
          <SearchableDropdown
            options={productOptions}
            value={selectedProductId}
            onChange={setSelectedProductId}
            placeholder={PRODUCT_PLACEHOLDER}
            className="w-full"
            buttonClassName="px-4 py-2"
          />
          {selectedProductId && (
            <p className="mt-2 text-xs text-orange-600 font-medium">
              ✅ จะผูก content นี้กับ: {allProducts.find((p) => p.id === selectedProductId)?.title_en}
            </p>
          )}
        </div>

        {/* Add block toolbar */}
        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={addTextBlock}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 transition text-sm font-semibold"
            >
              📝 เพิ่มบล็อกข้อความ
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 transition text-sm font-semibold disabled:opacity-60"
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  กำลังอัปโหลด...
                </>
              ) : (
                <>🖼️ เพิ่มรูปภาพ</>
              )}
            </button>
            <button
              onClick={addTextImageBlock}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 transition text-sm font-semibold"
            >
              📝🖼️ เพิ่มข้อความและรูปภาพ
            </button>
            <button
              onClick={addGalleryBlock}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 transition text-sm font-semibold"
            >
              🖼️🖼️ เพิ่มแกลลอรี่ (Gallery)
            </button>
            <button
              onClick={addYoutubeBlock}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 transition text-sm font-semibold"
            >
              ▶️ เพิ่มลิงก์ YouTube
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <input
            ref={replaceImageInputRef}
            type="file"
            accept="image/*"
            onChange={handleReplaceImageUpload}
            className="hidden"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleGalleryUpload}
            className="hidden"
          />
        </div>

        {/* Content Blocks */}
        <div className="mb-8">
          {blocks.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-dashed border-gray-300">
              <p className="text-gray-500">ไม่มีบล็อกใดแล้ว</p>
            </div>
          ) : (
            blocks.map((block, index) => (
              <div
                key={block.id}
                id={`block-${block.id}`}
                // Live gap: dragging "ระยะห่างล่าง" updates the space immediately.
                style={{ marginBottom: block.spacingBelow ?? 16 }}
                className="relative group transition-all duration-300 bg-white rounded-xl p-6 border-2 border-dashed border-gray-200 hover:border-orange-400"
              >
                <div className="absolute -top-3 left-3 z-10 flex gap-1">
                  <button
                    onClick={() => moveBlock(block.id, "up")}
                    disabled={index === 0}
                    title="เลื่อนบล็อกขึ้น"
                    className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-500 hover:bg-orange-50 hover:text-orange-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-gray-500 transition flex items-center justify-center text-sm font-bold shadow-md"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveBlock(block.id, "down")}
                    disabled={index === blocks.length - 1}
                    title="เลื่อนบล็อกลง"
                    className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-500 hover:bg-orange-50 hover:text-orange-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-gray-500 transition flex items-center justify-center text-sm font-bold shadow-md"
                  >
                    ▼
                  </button>
                </div>
                <button
                  onClick={() => deleteBlock(block.id)}
                  title="ลบบล็อกนี้"
                  className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-red-100 text-red-500 hover:bg-red-500 hover:text-white transition flex items-center justify-center text-sm font-bold shadow-md"
                >
                  ✕
                </button>

                {block.type === "gallery" ? (
                  <div className="flex flex-col items-center gap-4">
                    {/* Main Image */}
                    <div className="w-full flex items-center justify-center bg-gray-50 rounded-lg p-4 min-h-[300px] border border-gray-200">
                      {block.imageUrls && block.imageUrls.length > 0 ? (
                        <img
                          src={block.imageUrls[block.selectedImageIndex || 0]}
                          alt="Main Gallery"
                          className="max-w-full max-h-[500px] object-contain rounded-lg shadow-sm"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400">
                          {uploadingBlockId === block.id ? (
                            <div className="flex flex-col items-center">
                              <svg className="animate-spin h-8 w-8 text-orange-500 mb-2" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              <span className="text-sm">กำลังอัปโหลด...</span>
                            </div>
                          ) : (
                            <span>ยังไม่มีรูปภาพ กรุณาเพิ่มรูปภาพ</span>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Thumbnails */}
                    {block.imageUrls && block.imageUrls.length > 0 && (
                      <div className="flex flex-wrap gap-3 justify-center w-full p-2">
                        {block.imageUrls.map((url, idx) => (
                          <div key={idx} className="relative group">
                            <img
                              src={url}
                              alt={`Thumbnail ${idx}`}
                              onClick={() => updateBlock(block.id, { selectedImageIndex: idx })}
                              className={`w-24 h-24 object-cover rounded-md cursor-pointer border-4 ${
                                (block.selectedImageIndex || 0) === idx ? "border-orange-500 shadow-md" : "border-transparent"
                              } hover:border-orange-300 transition-all`}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newUrls = block.imageUrls!.filter((_, i) => i !== idx);
                                let newIndex = block.selectedImageIndex || 0;
                                if (newIndex >= newUrls.length) newIndex = Math.max(0, newUrls.length - 1);
                                updateBlock(block.id, { imageUrls: newUrls, selectedImageIndex: newIndex });
                              }}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-sm font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Upload button for gallery */}
                    {(!block.imageUrls || block.imageUrls.length < 10) && (
                      <button
                        onClick={() => {
                          setGalleryUploadingId(block.id);
                          galleryInputRef.current?.click();
                        }}
                        disabled={uploadingBlockId === block.id}
                        className="px-6 py-2.5 mt-4 text-sm rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition font-bold border border-orange-300 disabled:opacity-50 flex items-center gap-2 shadow-sm"
                      >
                        {uploadingBlockId === block.id ? (
                          <>
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            กำลังอัปโหลด...
                          </>
                        ) : (
                          `➕ เพิ่มรูปภาพ (${block.imageUrls?.length || 0}/10)`
                        )}
                      </button>
                    )}
                  </div>
                ) : block.type === "text" ? (
                  <div className="flex flex-col gap-4">
                    <RichTextEditor
                      value={block.content ?? ""}
                      onChange={(content) => updateBlock(block.id, { content })}
                      placeholder="พิมพ์ข้อความของคุณที่นี่..."
                    />
                  </div>
                ) : block.type === "image" ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative w-full flex justify-center">
                      {uploadingBlockId === block.id ? (
                        <div className="flex items-center justify-center w-64 h-40 bg-gray-100 rounded-lg">
                          <svg className="animate-spin h-8 w-8 text-orange-500" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </div>
                      ) : (
                        <img
                          src={block.imageUrl}
                          alt="Content"
                          className="h-auto rounded-lg"
                          style={{ width: `${block.imageWidth ?? 100}%` }}
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center items-center">
                      <button
                        onClick={() => {
                          setReplacingBlockId(block.id);
                          replaceImageInputRef.current?.click();
                        }}
                        className="px-4 py-1.5 text-sm rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition font-semibold border border-orange-300"
                      >
                        🔄 เปลี่ยนรูป
                      </button>
                      <BlockRangeControl
                        label="🔍 ขนาดรูป"
                        value={block.imageWidth ?? 100}
                        min={25}
                        max={100}
                        step={5}
                        unit="%"
                        onChange={(v) => updateBlock(block.id, { imageWidth: v })}
                      />
                    </div>
                  </div>
                ) : block.type === "text-image" ? (
                  <div className={`flex flex-col-reverse md:flex-row gap-8 items-center ${block.imagePosition === 'left' ? 'md:flex-row-reverse' : ''}`}>
                    <div className="flex-1 w-full min-w-0">
                      <div className="flex flex-col gap-4">
                        <RichTextEditor
                          value={block.content ?? ""}
                          onChange={(content) => updateBlock(block.id, { content })}
                          placeholder="พิมพ์ข้อความของคุณที่นี่..."
                        />
                      </div>
                    </div>
                    <div className="flex-1 w-full min-w-0 flex flex-col items-center">
                      <div className="relative w-full">
                        {uploadingBlockId === block.id ? (
                          <div className="flex items-center justify-center w-full h-64 bg-gray-100 rounded-lg">
                            <span className="text-sm text-gray-500">กำลังอัปโหลด...</span>
                          </div>
                        ) : block.imageUrl ? (
                          <img
                            src={block.imageUrl}
                            alt="Content"
                            className="h-auto object-cover rounded-lg mx-auto"
                            style={{ width: `${block.imageWidth ?? 100}%` }}
                          />
                        ) : (
                          <button
                            onClick={() => {
                              setReplacingBlockId(block.id);
                              replaceImageInputRef.current?.click();
                            }}
                            className="flex flex-col items-center justify-center w-full h-64 bg-gray-50 border-2 border-dashed border-gray-300 hover:border-orange-400 hover:text-orange-500 text-gray-400 transition cursor-pointer rounded-lg"
                          >
                            <span className="text-sm font-semibold">+ เพิ่มรูปภาพ</span>
                          </button>
                        )}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 w-full justify-center items-center">
                        {block.imageUrl && (
                          <button
                            onClick={() => {
                              setReplacingBlockId(block.id);
                              replaceImageInputRef.current?.click();
                            }}
                            className="px-4 py-1.5 text-sm rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition font-semibold border border-orange-300"
                          >
                            🔄 เปลี่ยนรูป
                          </button>
                        )}
                        <SearchableDropdown
                          searchable={false}
                          options={IMAGE_POSITION_OPTIONS}
                          value={block.imagePosition || "right"}
                          onChange={(value) =>
                            updateBlock(block.id, {
                              imagePosition: value as "left" | "right",
                            })
                          }
                          className="w-40"
                        />
                        {block.imageUrl && (
                          <BlockRangeControl
                            label="🔍 ขนาดรูป"
                            value={block.imageWidth ?? 100}
                            min={25}
                            max={100}
                            step={5}
                            unit="%"
                            onChange={(v) => updateBlock(block.id, { imageWidth: v })}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <input
                      type="url"
                      value={block.youtubeUrl ?? ""}
                      onChange={(e) => updateBlock(block.id, { youtubeUrl: e.target.value })}
                      placeholder="วางลิงก์ YouTube ที่นี่ เช่น https://www.youtube.com/watch?v=..."
                      className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-orange-400"
                    />
                    {block.youtubeUrl ? (
                      <YoutubeEmbed url={block.youtubeUrl} />
                    ) : (
                      <div className="aspect-video w-full rounded-lg bg-gray-50 border-2 border-dashed border-gray-300 flex items-center justify-center text-sm text-gray-400">
                        วางลิงก์ YouTube ด้านบนเพื่อดูตัวอย่าง
                      </div>
                    )}
                  </div>
                )}

                {/* Per-block spacing control (all block types) */}
                <div className="mt-4 pt-3 border-t border-dashed border-gray-200 flex justify-center">
                  <BlockRangeControl
                    label="↕ ระยะห่างล่าง"
                    value={block.spacingBelow ?? 16}
                    min={0}
                    max={100}
                    step={4}
                    unit="px"
                    onChange={(v) => updateBlock(block.id, { spacingBelow: v })}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={isUploading || uploadingBlockId !== null || galleryUploadingId !== null}
          className="w-full px-8 py-4 bg-orange-500 text-white font-bold text-lg rounded-lg hover:bg-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading || uploadingBlockId !== null || galleryUploadingId !== null ? "กำลังอัปโหลด..." : "Publish Content"}
        </button>

        {/* Back Link */}
        <div className="mt-4 text-center">
          <a href="/" className="text-gray-600 hover:text-gray-900">
            ← Back to Home
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

export default function CreateContent() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-500">Loading...</p></div>}>
      <CreateContentInner />
    </Suspense>
  );
}
