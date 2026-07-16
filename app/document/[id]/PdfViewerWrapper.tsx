"use client";
import dynamic from "next/dynamic";

const PdfViewerClient = dynamic(() => import("./PdfViewerClient"), { 
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
      <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      <p>กำลังเตรียมเครื่องมืออ่าน PDF...</p>
    </div>
  )
});

export default function PdfViewerWrapper({ url }: { url: string }) {
  return <PdfViewerClient url={url} />;
}
