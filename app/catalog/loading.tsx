// Skeleton shown while the catalog (document cards) loads on navigation.
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 pt-28 pb-20">
      <div className="max-w-6xl mx-auto px-4">
        <div className="h-9 w-72 rounded-lg bg-gray-200/70 animate-pulse mb-10" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
            >
              <div className="aspect-[3/4] bg-gray-200/70 animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-5 w-3/4 rounded bg-gray-200/60 animate-pulse" />
                <div className="h-4 w-1/2 rounded bg-gray-200/40 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
