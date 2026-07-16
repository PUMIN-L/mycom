// Shown instantly during client-side navigation to a content page while the
// server renders the real (SEO-friendly) HTML.
export default function Loading() {
  return (
    <div className="min-h-screen bg-white pt-25">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Title placeholder */}
        <div className="h-10 w-2/3 rounded-lg bg-gray-200/70 animate-pulse" />
        <div className="mt-3 h-5 w-32 rounded-full bg-gray-200/60 animate-pulse" />
      </div>
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3" style={{ animationDelay: `${i * 120}ms` }}>
            <div className="h-4 w-full rounded bg-gray-200/60 animate-pulse" />
            <div className="h-4 w-11/12 rounded bg-gray-200/60 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-gray-200/60 animate-pulse" />
            {i % 2 === 1 && (
              <div className="h-64 w-full rounded-lg bg-gray-200/70 animate-pulse" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
