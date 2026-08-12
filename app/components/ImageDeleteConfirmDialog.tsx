"use client";
import React, { useState } from "react";
import Image from "next/image";

export interface OrphanedImage {
  url: string;
  reason: string;
}

interface ImageDeleteConfirmDialogProps {
  /** List of images pending deletion confirmation. */
  images: OrphanedImage[];
  /** Called when the user has finished reviewing all images (or closes the dialog). */
  onComplete: () => void;
}

/**
 * A modal that shows orphaned Cloudinary images one-by-one, letting the admin
 * confirm ("ยืนยันลบ") or skip ("เก็บไว้") each image individually.
 *
 * Usage:
 *   {pendingImages.length > 0 && (
 *     <ImageDeleteConfirmDialog
 *       images={pendingImages}
 *       onComplete={() => setPendingImages([])}
 *     />
 *   )}
 */
export default function ImageDeleteConfirmDialog({
  images,
  onComplete,
}: ImageDeleteConfirmDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [results, setResults] = useState<{ url: string; deleted: boolean }[]>([]);

  if (images.length === 0) return null;

  const current = images[currentIndex];
  const isLast = currentIndex >= images.length - 1;
  const remaining = images.length - currentIndex;

  const advance = (deleted: boolean) => {
    setResults((prev) => [...prev, { url: current.url, deleted }]);
    if (isLast) {
      onComplete();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/upload/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: current.url }),
      });
      if (!res.ok) {
        console.error("Failed to delete image from Cloudinary");
      }
    } catch (err) {
      console.error("Error deleting image:", err);
    } finally {
      setDeleting(false);
      advance(true);
    }
  };

  const handleSkip = () => {
    advance(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-500 to-orange-500 px-6 py-4">
          <h3 className="text-white text-lg font-bold flex items-center gap-2">
            ⚠️ ยืนยันการลบรูปภาพจาก Cloudinary
          </h3>
          <p className="text-white/80 text-sm mt-1">
            รูปที่ {currentIndex + 1} จาก {images.length}
          </p>
        </div>

        {/* Image Preview */}
        <div className="p-6">
          <div className="relative w-full h-64 bg-gray-100 rounded-xl overflow-hidden border-2 border-dashed border-gray-200 mb-4">
            <Image
              src={current.url}
              alt="รูปที่จะลบ"
              fill
              className="object-contain"
              unoptimized
            />
          </div>

          {/* Reason */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
            <p className="text-sm text-amber-800">
              <span className="font-semibold">เหตุผล:</span> {current.reason}
            </p>
          </div>

          <p className="text-sm text-gray-500 mb-6 text-center">
            รูปนี้จะถูก<span className="text-red-600 font-bold">ลบถาวร</span>จาก Cloudinary
            หากยืนยัน จะไม่สามารถกู้คืนได้
          </p>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSkip}
              disabled={deleting}
              className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              เก็บไว้ไม่ลบ
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {deleting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  กำลังลบ...
                </>
              ) : (
                <>🗑️ ยืนยันลบ</>
              )}
            </button>
          </div>

          {/* Remaining indicator */}
          {remaining > 1 && (
            <p className="text-xs text-gray-400 text-center mt-3">
              เหลืออีก {remaining - 1} รูปที่ต้องยืนยัน
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
