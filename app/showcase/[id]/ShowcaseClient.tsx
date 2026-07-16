"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../i18n/LanguageContext";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import ColorPickerDropdown from "../../components/ColorPickerDropdown";
import ConfirmDialog from "../../components/ConfirmDialog";
import Toast from "../../components/Toast";
import RichTextEditor from "../../components/RichTextEditor";

interface ContentBlock {
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

interface ContentData {
  id: string;
  title: string;
  blocks: ContentBlock[];
  createdAt: string;
  productId?: string | null;
}

interface ProductItem {
  id: string;
  categoryId: number;
  title_th: string;
  title_en: string;
  title_zh: string;
}

interface ProductCategory {
  id: number;
  name_th: string;
  name_en: string;
  name_zh: string;
}

interface ShowcaseClientProps {
  initialContent: ContentData;
  initialAllContents: ContentData[];
  initialProducts: ProductItem[];
  initialCategories: ProductCategory[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function deleteImageFromCloudinary(imageUrl: string) {
  await fetch("/api/upload/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
}

function GalleryViewer({
  block,
  isEditing,
  updateBlock,
  uploadingBlockId,
  setGalleryUploadingId,
  galleryInputRef,
}: {
  block: ContentBlock;
  isEditing: boolean;
  updateBlock: (id: string, updates: Partial<ContentBlock>) => void;
  uploadingBlockId: string | null;
  setGalleryUploadingId: (id: string) => void;
  galleryInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [localIndex, setLocalIndex] = useState(block.selectedImageIndex || 0);
  const activeIndex = isEditing ? (block.selectedImageIndex || 0) : localIndex;
  
  const setIndex = (idx: number) => {
    if (isEditing) {
      updateBlock(block.id, { selectedImageIndex: idx });
    } else {
      setLocalIndex(idx);
    }
  };

  const images = block.imageUrls || [];

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Main Image */}
      <div className="w-full flex items-center justify-center bg-gray-50 rounded-lg p-4 min-h-[300px] border border-gray-200">
        {images.length > 0 ? (
          <img
            src={images[activeIndex]}
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
              <span>ยังไม่มีรูปภาพ</span>
            )}
          </div>
        )}
      </div>
      
      {/* Thumbnails */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3 justify-center w-full p-2">
          {images.map((url, idx) => (
            <div key={idx} className="relative group">
              <img
                src={url}
                alt={`Thumbnail ${idx}`}
                onClick={() => setIndex(idx)}
                className={`w-24 h-24 object-cover rounded-md cursor-pointer border-4 ${
                  activeIndex === idx ? "border-orange-500 shadow-md" : "border-transparent"
                } hover:border-orange-300 transition-all`}
              />
              {isEditing && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const newUrls = images.filter((_, i) => i !== idx);
                    let newIndex = activeIndex;
                    if (newIndex >= newUrls.length) newIndex = Math.max(0, newUrls.length - 1);
                    updateBlock(block.id, { imageUrls: newUrls, selectedImageIndex: newIndex });
                    try {
                      await deleteImageFromCloudinary(url);
                    } catch(err) {}
                  }}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-sm font-bold"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Upload button for gallery */}
      {isEditing && images.length < 10 && (
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
            `➕ เพิ่มรูปภาพ (${images.length}/10)`
          )}
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ShowcaseClient({
  initialContent,
  initialAllContents,
  initialProducts,
  initialCategories,
}: ShowcaseClientProps) {
  const router = useRouter();
  const { lang } = useLanguage();

  // Seeded from server-fetched data (no client loading spinner / waterfall).
  const [content, setContent] = useState<ContentData>(initialContent);
  const [allContents, setAllContents] = useState<ContentData[]>(initialAllContents);
  const { isLoggedIn } = useAuth();

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(initialContent.title);
  const [editBlocks, setEditBlocks] = useState<ContentBlock[]>(initialContent.blocks);
  // Mirror the latest blocks in a ref so async handlers (image upload/delete)
  // that also persist to the DB read the up-to-date list — not a stale snapshot
  // captured before the user kept typing during the upload.
  const editBlocksRef = useRef(editBlocks);
  useEffect(() => {
    editBlocksRef.current = editBlocks;
  }, [editBlocks]);
  const [editProductId, setEditProductId] = useState<string>(initialContent.productId ?? "");
  const [saving, setSaving] = useState(false);

  const [allProducts, setAllProducts] = useState<ProductItem[]>(initialProducts);
  const [allCategories, setAllCategories] = useState<ProductCategory[]>(initialCategories);

  // Delete content confirm
  const [showDeleteContentConfirm, setShowDeleteContentConfirm] = useState(false);
  const [deletingContent, setDeletingContent] = useState(false);

  // Delete block confirm
  const [pendingDeleteBlock, setPendingDeleteBlock] = useState<ContentBlock | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Image upload refs
  const fileInputRef = useRef<HTMLInputElement>(null);    // for replacing existing image
  const addImageFileRef = useRef<HTMLInputElement>(null); // for adding new image block
  const galleryInputRef = useRef<HTMLInputElement>(null); // for gallery
  const [galleryUploadingId, setGalleryUploadingId] = useState<string | null>(null);
  const [replacingBlockId, setReplacingBlockId] = useState<string | null>(null);
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const [addingImage, setAddingImage] = useState(false);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Delete whole content ───────────────────────────────────────────────────
  async function handleDeleteContent() {
    setDeletingContent(true);
    try {
      const res = await fetch(`/api/contents/${content.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("ลบ content สำเร็จ (รวมถึงรูปใน Cloudinary)", "success");
        setTimeout(() => router.push("/showcase"), 1200);
      } else {
        showToast("เกิดข้อผิดพลาดในการลบ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาดในการลบ", "error");
    } finally {
      setDeletingContent(false);
      setShowDeleteContentConfirm(false);
    }
  }

  const [isDeletingBlock, setIsDeletingBlock] = useState(false);

  // ── Delete single block ────────────────────────────────────────────────────
  async function handleDeleteBlock(block: ContentBlock) {
    setIsDeletingBlock(true);
    try {
      // Remove from edit blocks immediately (from the latest list)
      const newBlocks = editBlocksRef.current.filter((b) => b.id !== block.id);
      setEditBlocks(newBlocks);

      // If it's an image → delete from Cloudinary
      if (block.type === "image" && block.imageUrl) {
        await deleteImageFromCloudinary(block.imageUrl);
      }
      
      if (block.type === "gallery" && block.imageUrls) {
        for (const url of block.imageUrls) {
          try {
            await deleteImageFromCloudinary(url);
          } catch(err) { console.error("Error deleting gallery image", err); }
        }
      }

      // Persist update to DB
      await saveBlocks(newBlocks);
      showToast(
        block.type === "image" ? "ลบรูปภาพและรูปใน Cloudinary แล้ว" : "ลบข้อความแล้ว",
        "success"
      );
    } catch {
      showToast("เกิดข้อผิดพลาดในการลบบล็อก", "error");
    } finally {
      setIsDeletingBlock(false);
      setPendingDeleteBlock(null);
    }
  }

  // ── Save (PUT) ─────────────────────────────────────────────────────────────
  async function saveBlocks(blocks: ContentBlock[]) {
    if (!content) return;
    const res = await fetch(`/api/contents/${content.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, blocks }),
    });
    if (res.ok) {
      // Image/gallery/block operations auto-persist immediately. Keep the
      // `content` baseline in sync with what was just saved so that Cancel
      // (which resets editTitle/editBlocks from `content`) can't make the UI
      // "revert" a change that already lives in the DB — otherwise the view and
      // the database diverge.
      setContent((prev) => ({ ...prev, title: editTitle, blocks }));
    }
  }

  async function handleSaveEdit() {
    if (!content) return;
    if (!editTitle.trim()) {
      showToast("Title cannot be empty", "error");
      return;
    }
    if (!editProductId) {
      showToast("กรุณาเลือก Product ที่จะผูกกับ Content นี้", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/contents/${content.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, blocks: editBlocks, productId: editProductId || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        setContent(updated);
        setIsEditing(false);
        showToast("บันทึกสำเร็จ", "success");
      } else {
        showToast("บันทึกไม่สำเร็จ", "error");
      }
    } catch {
      showToast("เกิดข้อผิดพลาด", "error");
    } finally {
      setSaving(false);
    }
  }

  // ── Replace image in a block ───────────────────────────────────────────────
  async function handleReplaceImage(blockId: string, file: File) {
    setUploadingBlockId(blockId);
    try {
      // Find old block to delete its Cloudinary image
      const oldBlock = editBlocksRef.current.find((b) => b.id === blockId);
      if (oldBlock?.imageUrl) {
        await deleteImageFromCloudinary(oldBlock.imageUrl);
      }

      // Upload new image
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        showToast("อัปโหลดรูปใหม่ไม่สำเร็จ", "error");
        return;
      }
      const { url } = await uploadRes.json();

      // Merge into the LATEST blocks (so text typed during the upload isn't
      // lost), then persist that same version.
      const newBlocks = editBlocksRef.current.map((b) =>
        b.id === blockId ? { ...b, imageUrl: url } : b
      );
      setEditBlocks(newBlocks);
      await saveBlocks(newBlocks);
      showToast("เปลี่ยนรูปสำเร็จ", "success");
    } catch {
      showToast("เกิดข้อผิดพลาดในการเปลี่ยนรูป", "error");
    } finally {
      setUploadingBlockId(null);
      setReplacingBlockId(null);
    }
  }

  // ── Text block edit ────────────────────────────────────────────────────────
  function updateBlock(blockId: string, updates: Partial<ContentBlock>) {
    setEditBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, ...updates } : b))
    );
  }

  const scrollToBlock = (id: string) => {
    setTimeout(() => {
      document.getElementById(`block-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  // ── Add new text block ────────────────────────────────────────────────────
  function addTextBlock() {
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      type: "text",
      content: "",
      fontSize: "16",
      fontWeight: "400",
      textAlign: "left",
      textColor: "#111827",
    };
    setEditBlocks((prev) => [...prev, newBlock]);
    scrollToBlock(newBlock.id);
  }

  // ── Add new text-image block ───────────────────────────────────────────────
  function addTextImageBlock() {
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      type: "text-image",
      content: "Edit this text",
      imageUrl: "",
      imagePosition: "right",
      fontSize: "16",
      fontWeight: "400",
      textAlign: "left",
      textColor: "#111827",
    };
    setEditBlocks((prev) => [...prev, newBlock]);
    scrollToBlock(newBlock.id);
  }

  // ── Add new image block ────────────────────────────────────────────────────
  async function handleAddImage(file: File) {
    setAddingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        showToast("อัปโหลดรูปไม่สำเร็จ", "error");
        return;
      }
      const { url } = await uploadRes.json();
      const newBlock: ContentBlock = {
        id: crypto.randomUUID(),
        type: "image",
        imageUrl: url,
      };
      const newBlocks = [...editBlocksRef.current, newBlock];
      setEditBlocks(newBlocks);
      await saveBlocks(newBlocks);
      scrollToBlock(newBlock.id);
      showToast("เพิ่มรูปภาพสำเร็จ", "success");
    } catch {
      showToast("เกิดข้อผิดพลาดในการเพิ่มรูป", "error");
    } finally {
      setAddingImage(false);
    }
  }

  async function handleGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !galleryUploadingId) return;

    const block = editBlocksRef.current.find(b => b.id === galleryUploadingId);
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
        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const data = await uploadRes.json();
        return data.url;
      });

      const uploadedUrls = await Promise.all(uploadPromises);
      
      const newBlocks = editBlocksRef.current.map(b => 
        b.id === galleryUploadingId ? { ...b, imageUrls: [...(b.imageUrls || []), ...uploadedUrls] } : b
      );
      setEditBlocks(newBlocks);
      await saveBlocks(newBlocks);
      showToast("เพิ่มรูปลงแกลลอรี่สำเร็จ", "success");
    } catch {
      showToast("เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ", "error");
    } finally {
      setUploadingBlockId(null);
      setGalleryUploadingId(null);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  function addGalleryBlock() {
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      type: "gallery",
      imageUrls: [],
      selectedImageIndex: 0,
    };
    setEditBlocks((prev) => [...prev, newBlock]);
    scrollToBlock(newBlock.id);
  }

  const displayBlocks = isEditing ? editBlocks : content.blocks;

  return (
    <>
    <Navbar />
    <div className="min-h-screen bg-white pt-25">
      {/* ── Toast ── */}
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* ── Confirm delete content ── */}
      {showDeleteContentConfirm && (
        <ConfirmDialog
          message={`ต้องการลบ "${content.title}" ใช่ไหม? รูปภาพทั้งหมดใน Content นี้จะถูกลบออกจาก Cloudinary ด้วย`}
          onConfirm={handleDeleteContent}
          onCancel={() => setShowDeleteContentConfirm(false)}
          loading={deletingContent}
        />
      )}

      {/* ── Confirm delete block ── */}
      {pendingDeleteBlock && (
        <ConfirmDialog
          message={
            pendingDeleteBlock.type === "image"
              ? "ต้องการลบรูปภาพนี้ใช่ไหม? รูปจะถูกลบออกจาก Cloudinary ด้วย"
              : "ต้องการลบข้อความนี้ใช่ไหม?"
          }
          onConfirm={() => handleDeleteBlock(pendingDeleteBlock)}
          onCancel={() => setPendingDeleteBlock(null)}
          loading={isDeletingBlock}
        />
      )}

      {/* Hidden file input for image replacement */}
      {/* File input: replace existing image */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && replacingBlockId) {
            handleReplaceImage(replacingBlockId, file);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={addImageFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleAddImage(file);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleGalleryUpload}
      />

      {/* ── Header ── */}
      <div className="bg-white">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-3xl font-bold text-gray-900 border-b-2 border-orange-400 focus:outline-none bg-transparent w-full"
                />
              ) : (
                <h1 className="text-4xl font-bold text-gray-900 truncate">{content.title}</h1>
              )}

              {/* Product badge / selector */}
              {isEditing ? (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">ผูกกับ Product (จำเป็น)</label>
                  <select
                    value={editProductId}
                    onChange={(e) => setEditProductId(e.target.value)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-orange-400 bg-white"
                  >
                    <option value="" disabled>-- กรุณาเลือก Product --</option>
                    {allCategories.map((cat) => (
                      <optgroup key={cat.id} label={cat.name_en}>
                        {allProducts
                          .filter((p) => p.categoryId === cat.id)
                          .map((p) => {
                            // Find if this product is already linked to another content
                            const linkedContent = allContents.find((c) => c.productId === p.id && c.id !== content?.id);
                            const isLinked = !!linkedContent;
                            return (
                              <option key={p.id} value={p.id} disabled={isLinked}>
                                {p.title_en} {isLinked ? "(มี Content แล้ว)" : ""}
                              </option>
                            );
                          })}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ) : content.productId ? (
                <div className="mt-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-orange-100 text-orange-700 px-3 py-1 rounded-full">
                    {(() => {
                      const p = allProducts.find((p) => p.id === content.productId);
                      if (!p) return content.productId;
                      if (lang === "zh") return p.title_zh || p.title_en || p.title_th;
                      if (lang === "en") return p.title_en || p.title_th;
                      return p.title_th || p.title_en || p.title_zh;
                    })()}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Action buttons — only logged-in users */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {isLoggedIn && (
                isEditing ? (
                  <>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditTitle(content.title);
                        setEditBlocks(content.blocks);
                        setEditProductId(content.productId ?? "");
                      }}
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition text-sm"
                    >
                      ยกเลิก
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className="px-4 py-2 rounded-lg bg-green-500 text-white font-semibold hover:bg-green-600 transition text-sm disabled:opacity-60 flex items-center gap-2"
                    >
                      {saving && (
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      )}
                      {saving ? "กำลังบันทึก..." : "💾 บันทึก"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-4 py-2 rounded-lg border border-orange-400 text-orange-600 font-semibold hover:bg-orange-50 transition text-sm"
                    >
                      ✏️ แก้ไข
                    </button>
                    <button
                      onClick={() => setShowDeleteContentConfirm(true)}
                      disabled={deletingContent}
                      className="px-4 py-2 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition text-sm disabled:opacity-60"
                    >
                      🗑️ ลบ Content
                    </button>
                    <Link
                      href="/create-content"
                      className="px-4 py-2 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 transition text-sm"
                    >
                      + สร้างใหม่
                    </Link>
                  </>
                )
              )}
            </div>
          </div>
        </div>
      </div>


      {/* ── Content Blocks ── */}
      <div className="max-w-4xl mx-auto px-4 py-10">
        {isEditing && (
          <div className="mb-4 space-y-3">
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700 font-medium">
              🖊️ โหมดแก้ไข — แก้ไขข้อความในแต่ละบล็อกได้โดยตรง กดปุ่ม ✕ เพื่อลบบล็อก
            </div>
            {/* Add block toolbar */}
            <div className="flex gap-3">
              <button
                onClick={addTextBlock}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 transition text-sm font-semibold"
              >
                📝 เพิ่มบล็อกข้อความ
              </button>
              <button
                onClick={() => addImageFileRef.current?.click()}
                disabled={addingImage}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-600 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50 transition text-sm font-semibold disabled:opacity-60"
              >
                {addingImage ? (
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
            </div>
          </div>
        )}

        <div className="space-y-4">
          {displayBlocks.map((block) => (
            <div
              key={block.id}
              id={`block-${block.id}`}
              className={`relative group transition-all duration-300 ${
                isEditing ? "bg-white rounded-xl p-6 border-2 border-dashed border-gray-200 hover:border-orange-400" : "py-2"
              }`}
            >
              {/* Delete block button (shown in edit mode or on hover when editing) */}
              {isEditing && (
                <button
                  onClick={() => setPendingDeleteBlock(block)}
                  title="ลบบล็อกนี้"
                  className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-red-100 text-red-500 hover:bg-red-500 hover:text-white transition flex items-center justify-center text-sm font-bold shadow-md"
                >
                  ✕
                </button>
              )}

              {block.type === "gallery" ? (
                <GalleryViewer 
                  block={block} 
                  isEditing={isEditing} 
                  updateBlock={updateBlock}
                  uploadingBlockId={uploadingBlockId}
                  setGalleryUploadingId={setGalleryUploadingId}
                  galleryInputRef={galleryInputRef}
                />
              ) : block.type === "text" ? (
                isEditing ? (
                  <div className="flex flex-col gap-4">
                    <RichTextEditor
                      value={block.content ?? ""}
                      onChange={(content) => updateBlock(block.id, { content })}
                      placeholder="พิมพ์ข้อความของคุณที่นี่..."
                    />
                  </div>
                ) : (
                    <div
                      className="w-full break-words"
                      style={{
                        fontSize: `${block.fontSize}px`,
                        fontWeight: block.fontWeight as any,
                        textAlign: block.textAlign as any,
                        color: block.textColor,
                        lineHeight: "1.6",
                      }}
                      dangerouslySetInnerHTML={{ __html: block.content ?? "" }}
                    />
                  )
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
                          className="w-full h-auto"
                        />
                    )}
                  </div>
                  {isEditing && (
                    <button
                      onClick={() => {
                        setReplacingBlockId(block.id);
                        fileInputRef.current?.click();
                      }}
                      className="px-4 py-1.5 text-sm rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition font-semibold border border-orange-300"
                    >
                      🔄 เปลี่ยนรูป
                    </button>
                  )}
                </div>
              ) : (
                <div className={`flex flex-col-reverse md:flex-row gap-8 items-center ${block.imagePosition === 'left' ? 'md:flex-row-reverse' : ''}`}>
                  <div className="flex-1 w-full min-w-0">
                    {isEditing ? (
                      <div className="flex flex-col gap-4">
                        <RichTextEditor
                          value={block.content ?? ""}
                          onChange={(content) => updateBlock(block.id, { content })}
                          placeholder="พิมพ์ข้อความของคุณที่นี่..."
                        />
                      </div>
                    ) : (
                      <div
                        className="w-full break-words"
                        style={{
                          fontSize: `${block.fontSize}px`,
                          fontWeight: block.fontWeight as any,
                          textAlign: block.textAlign as any,
                          color: block.textColor,
                          lineHeight: "1.6",
                        }}
                        dangerouslySetInnerHTML={{ __html: block.content ?? "" }}
                      />
                    )}
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
                          className="w-full h-auto object-cover"
                        />
                      ) : isEditing ? (
                        <button
                          onClick={() => {
                            setReplacingBlockId(block.id);
                            fileInputRef.current?.click();
                          }}
                          className="flex flex-col items-center justify-center w-full h-64 bg-gray-50 border-2 border-dashed border-gray-300 hover:border-orange-400 hover:text-orange-500 text-gray-400 transition cursor-pointer"
                        >
                          <span className="text-sm font-semibold">+ เพิ่มรูปภาพ</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-center w-full h-64 bg-gray-50 border-2 border-dashed border-gray-300">
                          <span className="text-sm text-gray-400">ยังไม่มีรูปภาพ</span>
                        </div>
                      )}
                    </div>
                    {isEditing && (
                      <div className="mt-4 flex gap-2 w-full justify-center">
                        {block.imageUrl && (
                          <button
                            onClick={() => {
                              setReplacingBlockId(block.id);
                              fileInputRef.current?.click();
                            }}
                            className="px-4 py-1.5 text-sm rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition font-semibold border border-orange-300"
                          >
                            🔄 เปลี่ยนรูป
                          </button>
                        )}
                        <select
                          value={block.imagePosition || "right"}
                          onChange={(e) =>
                            updateBlock(block.id, {
                              imagePosition: e.target.value as "left" | "right",
                            })
                          }
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-orange-400"
                        >
                          <option value="right">รูปอยู่ขวา</option>
                          <option value="left">รูปอยู่ซ้าย</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {displayBlocks.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-dashed border-gray-300">
              <p className="text-gray-500">ไม่มีบล็อกใดแล้ว</p>
            </div>
          )}
        </div>

        {/* ── Other Contents — only for logged-in users ── */}
        {!isEditing && isLoggedIn && (
          <div className="mt-12 bg-white rounded-xl shadow-sm p-8 border border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Other Contents</h2>
            {allContents.filter((c) => c.id !== content.id).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allContents
                  .filter((c) => c.id !== content.id)
                  .map((c: ContentData) => (
                    <Link
                      key={c.id}
                      href={`/showcase/${c.id}`}
                      className="p-5 rounded-xl border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition"
                    >
                      <h3 className="font-bold text-gray-900 truncate">{c.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </p>
                    </Link>
                  ))}
              </div>
            ) : (
              <p className="text-gray-500">ไม่มี content อื่นแล้ว</p>
            )}
          </div>
        )}

        {/* ── Footer links ── */}
        {!isEditing && (
          <div className="mt-8 text-center space-y-4">
            {isLoggedIn && (
              <Link
                href="/create-content"
                className="inline-block px-8 py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition shadow"
              >
                + Create New Content
              </Link>
            )}
            {isLoggedIn && (
              <p>
                <Link href="/showcase" className="text-orange-500 hover:text-orange-600 font-medium">
                  ← Back to All Contents
                </Link>
              </p>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
        .animate-slideUp { animation: slideUp 0.3s ease-out; }
      `}</style>
    </div>
    <Footer />
    </>
  );
}
