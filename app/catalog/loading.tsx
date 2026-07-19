// Skeleton shown while the catalog loads. Renders INSIDE catalog/layout.tsx
// (Navbar + main + Footer stay mounted), and mirrors CatalogClient's real
// layout — same wrapper, centered header, grid columns, and 4:3 card — so there
// is no reflow when the documents resolve.
export default function Loading() {
  return (
    <div className="section-wrapper">
      <div className="text-center mb-16">
        <div className="h-11 w-80 max-w-full mx-auto mt-8 rounded-lg bg-gray-200/70 animate-pulse" />
        <div className="h-5 w-96 max-w-full mx-auto mt-4 rounded bg-gray-200/50 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm"
          >
            <div className="aspect-[4/3] bg-gray-100 border-b border-gray-100 animate-pulse" />
            <div className="p-5 space-y-3">
              <div className="h-5 w-3/4 rounded bg-gray-200/60 animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-gray-200/40 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
