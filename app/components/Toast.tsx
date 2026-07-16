// Shared bottom-right toast for success / error feedback.
export default function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error";
}) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-[110] px-5 py-3 rounded-xl shadow-lg font-semibold text-white animate-slideUp flex items-center gap-2 ${
        type === "success" ? "bg-green-500" : "bg-red-500"
      }`}
    >
      {type === "success" ? "✅" : "❌"} {message}
    </div>
  );
}
