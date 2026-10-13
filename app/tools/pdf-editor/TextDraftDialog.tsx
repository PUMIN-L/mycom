"use client";

import TextStyleControls, { cssColor, type TextStyle } from "./TextStyleControls";

/**
 * The text dialog: what the text says AND how it looks — size, bold, italic,
 * colour, alignment, angle — chosen right here, for this text. Used to place a
 * new text (starting from the toolbar's style) and to edit a placed one
 * (starting from that text's own style).
 *
 * The box previews the look as you type. Its size is clamped to stay readable
 * in the box; the true size shows on the page.
 */
export default function TextDraftDialog({
  editing,
  value,
  style,
  onValueChange,
  onStyleChange,
  onCancel,
  onCommit,
}: {
  editing: boolean;
  value: string;
  style: TextStyle;
  onValueChange: (value: string) => void;
  onStyleChange: (style: TextStyle) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const previewPx = Math.min(Math.max(style.sizePt, 12), 28);
  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-editor-text-dialog-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4">
        <h3 id="pdf-editor-text-dialog-title" className="text-lg font-bold text-gray-900">
          {editing ? "แก้ไขข้อความ" : "พิมพ์ข้อความที่จะวางลงบนเอกสาร"}
        </h3>

        <TextStyleControls style={style} onChange={onStyleChange} />

        <div>
          <label htmlFor="pdf-editor-text-draft" className="block text-xs font-bold text-gray-500 mb-1">
            ข้อความ (ฟอนต์ Sarabun)
          </label>
          <textarea
            id="pdf-editor-text-draft"
            autoFocus
            rows={4}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-200"
            style={{
              fontFamily: "Sarabun, sans-serif",
              fontWeight: style.bold ? 700 : 400,
              fontStyle: style.italic ? "italic" : "normal",
              textAlign: style.align,
              color: cssColor(style.color),
              fontSize: `${previewPx}px`,
              lineHeight: 1.4,
            }}
            placeholder="พิมพ์ข้อความที่นี่..."
          />
          <p className="mt-1 text-xs text-gray-400">
            ขนาดจริง {style.sizePt} pt ดูได้บนหน้าเอกสาร ในกล่องนี้แสดงแบบย่อให้อ่านง่าย
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={value.trim().length === 0}
            className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {editing ? "บันทึกข้อความ" : "วางข้อความ"}
          </button>
        </div>
      </div>
    </div>
  );
}
