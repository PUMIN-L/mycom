import Spinner from "./Spinner";

// Shared confirmation modal. Defaults are tuned for delete actions (the most
// common use) but every label can be overridden via props.
export default function ConfirmDialog({
  title = "ยืนยันการลบ",
  message,
  confirmText = "ลบ",
  loadingText = "กำลังลบ...",
  cancelText = "ยกเลิก",
  onConfirm,
  onCancel,
  loading = false,
}: {
  title?: string;
  message: string;
  confirmText?: string;
  loadingText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 animate-fadeIn">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">⚠️</span>
          <h3 className="text-xl font-bold text-gray-900">{title}</h3>
        </div>
        <p className="text-gray-600 mb-6 whitespace-pre-wrap">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition disabled:opacity-60"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition flex justify-center items-center gap-2 disabled:opacity-60"
          >
            {loading && <Spinner className="h-4 w-4 text-white" />}
            {loading ? loadingText : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
