// Server component — rendered into the static shell as the <Suspense> fallback
// for <Products> while the product data streams in. Mirrors the real layout so
// there is no layout shift when the content swaps in.
export default function ProductsSkeleton() {
  return (
    <section
      id="products"
      aria-busy="true"
      aria-label="กำลังโหลดสินค้า"
      className="py-24 md:py-32 lg:py-10 bg-[var(--bg-secondary)] relative"
    >
      <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-[var(--accent)] opacity-[0.03] rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2" />

      <div className="section-wrapper relative z-10">
        {/* Section header placeholder */}
        <div className="text-center mb-16 md:mb-24">
          <div className="mx-auto h-8 md:h-10 w-64 max-w-[70%] rounded-lg bg-gray-200/70 animate-pulse" />
        </div>

        <div className="flex flex-col lg:flex-row gap-16 lg:gap-24">
          {/* Sidebar placeholder */}
          <div className="lg:w-1/4 w-full">
            <div className="lg:sticky lg:top-32 self-start mb-12 lg:mb-0">
              <div className="flex flex-row lg:flex-col gap-4 lg:gap-8 overflow-hidden">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-7 md:h-8 w-32 rounded-md bg-gray-200/70 animate-pulse flex-shrink-0"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Product grid placeholder */}
          <div className="lg:w-3/4 min-h-[650px]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-16">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col overflow-hidden rounded-sm"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  {/* Image placeholder — matches aspect-[4/5] of real cards */}
                  <div className="relative aspect-[4/5] w-full bg-gray-200/70 animate-pulse" />
                  <div className="flex flex-col p-6 md:p-8 gap-4">
                    <div className="h-6 md:h-7 w-3/4 rounded-md bg-gray-200/70 animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-3 w-full rounded bg-gray-200/60 animate-pulse" />
                      <div className="h-3 w-5/6 rounded bg-gray-200/60 animate-pulse" />
                    </div>
                    <div className="h-3 w-28 rounded bg-gray-200/60 animate-pulse mt-2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
