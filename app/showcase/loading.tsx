// Skeleton shown while the showcase list (content + documents) loads on
// navigation, so the page never flashes empty.
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="h-10 w-64 rounded-lg bg-gray-200/70 animate-pulse mb-10" />
        <div className="h-12 w-full max-w-xl rounded-xl bg-gray-200/60 animate-pulse mb-10" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-200 p-6 space-y-4"
            >
              <div className="h-7 w-3/4 rounded bg-gray-200/70 animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-gray-200/50 animate-pulse" />
              <div className="pt-4 border-t border-gray-100 flex justify-between">
                <div className="h-4 w-24 rounded bg-gray-200/50 animate-pulse" />
                <div className="h-4 w-12 rounded bg-gray-200/50 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
