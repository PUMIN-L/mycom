"use client";
import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import ColorPickerDropdown from "../components/ColorPickerDropdown";
import RichTextEditor from "../components/RichTextEditor";

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
      alert("Error uploading image. Please try again.");
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
      alert("Error uploading image");
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
      alert("สามารถเพิ่มรูปได้ไม่เกิน 10 รูป");
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
      alert("Error uploading images");
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
    if (!title.trim()) {
      alert("Please enter a title");
      return;
    }
    if (blocks.length === 0) {
      alert("Please add at least one content block");
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
        let errMsg = "Failed to save content";
        try {
          const errData = await response.json();
          if (errData.details) {
            errMsg += ` (${errData.details})`;
          }
        } catch (_) {}
        throw new Error(errMsg);
      }

      // Redirect to showcase page
      router.push(`/showcase/${contentData.id}`);
    } catch (error: any) {
      alert(error.message || "Error saving content. Please try again.");
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-4xl font-bold mb-2 text-gray-900">Create Content</h1>
        <p className="text-gray-600 mb-8">
          Build your content by adding text and images
        </p>

        {/* Title Input */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-2 text-gray-700">
            Content Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder="Enter your content title..."
          />
        </div>

        {/* Product Selector */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-semibold mb-2 text-gray-700">
            ผูกกับ Product (จำเป็น)
          </label>
          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
          >
            <option value="" disabled>-- กรุณาเลือก Product --</option>
            {allCategories.map((cat) => (
              <optgroup key={cat.id} label={cat.name_en}>
                {allProducts
                  .filter((p) => p.categoryId === cat.id)
                  .map((p) => {
                    const isLinked = linkedProductIds.has(p.id);
                    return (
                      <option key={p.id} value={p.id} disabled={isLinked && p.id !== searchParams.get("productId")}>
                        {p.title_en} {isLinked ? "(มี Content แล้ว - ต้องลบของเก่าก่อน)" : ""}
                      </option>
                    );
                  })}
              </optgroup>
            ))}
          </select>
          {selectedProductId && (
            <p className="mt-2 text-xs text-orange-600 font-medium">
              ✅ จะผูก content นี้กับ: {allProducts.find((p) => p.id === selectedProductId)?.title_en}
            </p>
          )}
        </div>

        {/* Add block toolbar */}
        <div className="mb-6 space-y-3">
          <div className="flex gap-3">
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
        <div className="space-y-4 mb-8">
          {blocks.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-dashed border-gray-300">
              <p className="text-gray-500">ไม่มีบล็อกใดแล้ว</p>
            </div>
          ) : (
            blocks.map((block) => (
              <div
                key={block.id}
                id={`block-${block.id}`}
                className="relative group transition-all duration-300 bg-white rounded-xl p-6 border-2 border-dashed border-gray-200 hover:border-orange-400 mb-6"
              >
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
                          className="w-full h-auto rounded-lg"
                        />
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setReplacingBlockId(block.id);
                        replaceImageInputRef.current?.click();
                      }}
                      className="px-4 py-1.5 text-sm rounded-lg bg-orange-100 text-orange-600 hover:bg-orange-200 transition font-semibold border border-orange-300"
                    >
                      🔄 เปลี่ยนรูป
                    </button>
                  </div>
                ) : (
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
                            className="w-full h-auto object-cover rounded-lg"
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
                      <div className="mt-4 flex gap-2 w-full justify-center">
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
                    </div>
                  </div>
                )}
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
