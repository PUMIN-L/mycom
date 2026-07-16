"use client";

import { DocumentData } from "../lib/documentStore";
import { useT } from "../i18n/LanguageContext";
import { translations } from "../i18n/translations";
import Image from "next/image";
import Link from "next/link";

interface CatalogClientProps {
  initialDocuments: DocumentData[];
}

export default function CatalogClient({ initialDocuments }: CatalogClientProps) {
  const t = useT();

  return (
    <div className="section-wrapper">
      <div className="text-center mb-16">
        <h1 className="text-4xl md:text-5xl font-serif font-bold text-[#2d2e38] mb-4 mt-8">
          {t(translations.catalogPage.title)}
        </h1>
        <p className="text-lg text-gray-500 max-w-4xl mx-auto">
          {t(translations.catalogPage.description)}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {initialDocuments.length === 0 ? (
          <div className="col-span-full py-20 text-center text-gray-400">
            {t(translations.catalogPage.noCatalogs)}
          </div>
        ) : (
          initialDocuments.map((doc) => (
            <Link 
              href={`/document/${doc.id}`} 
              key={doc.id}
              target="_blank"
              className="group flex flex-col bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
            >
              {/* Cover Image Area */}
              <div className="relative aspect-[4/3] bg-gray-50 border-b border-gray-100 overflow-hidden p-4">
                {doc.coverUrl ? (
                  <div className="relative w-full h-full shadow-sm rounded overflow-hidden">
                    <Image
                      src={doc.coverUrl}
                      alt={doc.title}
                      fill
                      className="object-cover object-top transition-transform duration-700 group-hover:scale-105"
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </div>
                )}
                
                {/* Glassmorphism Overlay on Hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-6">
                  <div className="px-5 py-2 bg-white/20 backdrop-blur-md border border-white/30 rounded-full text-white text-sm font-medium shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
                    {t(translations.catalogPage.viewPdf)}
                  </div>
                </div>
              </div>

              {/* Text Content */}
              <div className="p-5 flex flex-col flex-grow">
                <h3 className="text-lg font-bold text-gray-800 mb-1 line-clamp-2 group-hover:text-[var(--accent)] transition-colors">
                  {doc.title}
                </h3>
                {doc.description && (
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {doc.description}
                  </p>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
