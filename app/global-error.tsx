"use client";

// Last-resort boundary: catches errors in the ROOT layout itself. It replaces
// the entire document (must render its own <html>/<body>) and globals.css is not
// applied here, so styles are inline. Ordinary page errors are handled by
// error.tsx — this only fires if the layout/providers throw.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="th">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            textAlign: "center",
            background: "#f9fafb",
            color: "#111827",
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>
            เกิดข้อผิดพลาดร้ายแรง
          </h1>
          <p style={{ color: "#4b5563", maxWidth: 420, marginBottom: 28 }}>
            ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง
          </p>
          <button
            onClick={reset}
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              fontWeight: 600,
              color: "#fff",
              background: "#87704d",
              border: "none",
              cursor: "pointer",
            }}
          >
            ลองใหม่อีกครั้ง
          </button>
        </div>
      </body>
    </html>
  );
}
