"use client";

/**
 * A small "task created" confirmation dialog, shared by the quick-create
 * "สร้างสิ่งที่ต้องทำ" buttons on `EquipmentDetailsModal` and
 * `CustomerDetailsModal`. Replaces the native `alert()` EquipmentDetailsModal
 * used to call for this (and the toast-only feedback CustomerDetailsModal
 * used to give) with the same styled dialog either way, matching the
 * delete-confirm dialogs already elsewhere in this codebase
 * (`text-5xl` icon + title + message + one button, `max-w-sm p-6 text-center`).
 */
interface TaskCreatedNoticeProps {
  message: string;
  onClose: () => void;
}

export default function TaskCreatedNotice({ message, onClose }: TaskCreatedNoticeProps) {
  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-5xl mb-4">✅</div>
        <h3 className="text-lg font-bold text-gray-800 mb-2">สร้างงานสำเร็จ</h3>
        <p className="text-gray-500 text-sm mb-6">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-all w-full"
        >
          ตกลง
        </button>
      </div>
    </div>
  );
}
