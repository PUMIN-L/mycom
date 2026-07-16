"use client";
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { 
  ssr: false,
  loading: () => <div className="h-48 bg-gray-50 animate-pulse rounded-lg border border-gray-200"></div>
});

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

export default function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const modules = useMemo(() => ({
    toolbar: [
      [{ 'size': [] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      ['clean']
    ],
  }), []);

  return (
    <div className="rounded-lg overflow-hidden border border-gray-300 focus-within:border-orange-500 focus-within:ring-1 focus-within:ring-orange-500 transition-colors [&_.ql-toolbar]:border-none [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-gray-300 [&_.ql-toolbar]:bg-gray-50 [&_.ql-container]:border-none [&_.ql-editor]:min-h-[150px] [&_.ql-editor]:text-base">
      <ReactQuill
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        placeholder={placeholder}
      />
    </div>
  );
}
