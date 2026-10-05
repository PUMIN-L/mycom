"use client";
// /assets/labels and /stock/labels — print stickers for the chosen pieces
// (optional: nothing else depends on them). Each sticker: a QR that opens the
// piece's own page, its code, name and model. The QR is made in the browser
// (the `qrcode` package) — nothing is sent anywhere.
//
// Which pieces: ?ids=a,b (one piece, from its own page) or the list the
// register page left in sessionStorage (labelsStorageKey).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import SearchableDropdown from "../SearchableDropdown";
import type { InventoryGroup, InventoryItem, InventoryKind } from "../../lib/types";
import { INVENTORY_BASE_PATH, INVENTORY_TITLE } from "../../lib/inventoryStatus";
import {
  LABEL_PRESETS,
  DEFAULT_LABEL_PRESET_ID,
  labelPreset,
  labelsPerPage,
  layoutLabels,
  labelPosition,
  clampStartAt,
  type LabelPreset,
} from "../../lib/inventoryLabels";
import { apiJson, inventoryApi, inputClass, primaryButton, secondaryButton } from "./inventoryUi";
import { labelsStorageKey } from "./InventoryListPage";

const PRESET_STORAGE_KEY = "inventory-labels:preset";

interface Sticker {
  item: InventoryItem;
  group: InventoryGroup | undefined;
}

function readIds(kind: InventoryKind, fromQuery: string | null): string[] {
  if (fromQuery) return fromQuery.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const raw = sessionStorage.getItem(labelsStorageKey(kind));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export default function InventoryLabelsPage({ kind }: { kind: InventoryKind }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn, isLoading } = useAuth();
  const base = INVENTORY_BASE_PATH[kind];
  const idsParam = searchParams.get("ids");

  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [presetId, setPresetId] = useState(DEFAULT_LABEL_PRESET_ID);
  const [startAtText, setStartAtText] = useState("1");
  const [qr, setQr] = useState<Record<string, string>>({});
  const [qrFailed, setQrFailed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoading, isLoggedIn, router]);

  // Browser-only state, read after mount (the server render has neither).
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(PRESET_STORAGE_KEY);
    } catch {
      /* storage blocked: the default stands */
    }
    const id = setTimeout(() => {
      setMounted(true);
      if (saved && LABEL_PRESETS.some((p) => p.id === saved)) setPresetId(saved);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    const ids = readIds(kind, idsParam);
    apiJson<{ groups: InventoryGroup[]; items: InventoryItem[] }>(inventoryApi(kind))
      .then(({ groups, items }) => {
        const wanted = new Set(ids);
        const groupById = new Map(groups.map((g) => [g.id, g]));
        setStickers(
          items
            .filter((i) => wanted.has(i.id))
            .sort((a, b) => a.seq - b.seq)
            .map((item) => ({ item, group: groupById.get(item.groupId) }))
        );
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"));
  }, [isLoggedIn, kind, idsParam]);

  // One QR per piece, pointing at its own page on this site.
  useEffect(() => {
    if (!stickers || stickers.length === 0) return;
    let cancelled = false;
    (async () => {
      const QRCode = (await import("qrcode")).default;
      const out: Record<string, string> = {};
      for (const { item } of stickers) {
        out[item.id] = await QRCode.toDataURL(`${window.location.origin}${base}/item/${item.id}`, {
          margin: 0,
          width: 256,
          errorCorrectionLevel: "M",
        });
      }
      if (!cancelled) setQr(out);
    })().catch(() => {
      // Without QR the stickers still carry the code: let them print.
      if (!cancelled) setQrFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [stickers, base]);

  const preset = labelPreset(presetId);
  const startAt = clampStartAt(preset, Number(startAtText));
  const pages = useMemo(() => layoutLabels(stickers ?? [], preset, startAt), [stickers, preset, startAt]);
  // Printing before the QR codes are drawn would put grey boxes on the stickers.
  const qrPending = !!stickers && stickers.length > 0 && !qrFailed && !stickers.every((s) => qr[s.item.id]);

  function choosePreset(id: string) {
    setPresetId(id);
    setStartAtText("1");
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, id);
    } catch {
      /* not remembered — fine */
    }
  }

  if (isLoading || !isLoggedIn) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-orange-500" />
      </div>
    );
  }

  const sheets = (screen: boolean) =>
    pages.map((cells, p) => (
      <div
        key={p}
        className="sheet"
        style={{
          position: "relative",
          width: `${preset.pageWidthMm}mm`,
          height: `${preset.pageHeightMm}mm`,
          background: "white",
          overflow: "hidden",
          ...(screen ? { boxShadow: "0 1px 4px rgba(0,0,0,.15)", flexShrink: 0 } : {}),
        }}
      >
        {cells.map((cell, i) => (
          <LabelCell key={i} preset={preset} index={i} sticker={cell} qr={cell ? qr[cell.item.id] : undefined} outline={screen} />
        ))}
      </div>
    ));

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <Link href={base} className="text-xs font-semibold text-gray-400 hover:text-gray-600">
              ← {INVENTORY_TITLE[kind]}
            </Link>
            <h1 className="text-xl font-bold text-gray-900">พิมพ์สติกเกอร์</h1>
          </div>
          <div className="flex gap-2">
            <button type="button" className={secondaryButton} onClick={() => router.back()}>
              กลับ
            </button>
            <button
              type="button"
              className={primaryButton}
              onClick={() => window.print()}
              disabled={!stickers || stickers.length === 0 || qrPending}
            >
              {qrPending ? "กำลังสร้าง QR…" : "พิมพ์"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:px-6">
        <section className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-[1fr_12rem]">
          <div>
            <p className="mb-1 text-sm font-semibold text-gray-700">ขนาดกระดาษ</p>
            <SearchableDropdown
              options={LABEL_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
              value={presetId}
              onChange={choosePreset}
              searchable={false}
            />
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold text-gray-700">เริ่มที่ดวงที่</p>
            <input
              type="number"
              min={1}
              max={labelsPerPage(preset)}
              inputMode="numeric"
              className={inputClass}
              value={startAtText}
              disabled={labelsPerPage(preset) === 1}
              onChange={(e) => setStartAtText(e.target.value)}
              onBlur={() => setStartAtText(String(startAt))}
            />
          </div>
          <p className="text-xs text-gray-500 sm:col-span-2">
            {stickers ? `${stickers.length} ดวง · ${pages.length} หน้า` : "กำลังโหลด…"} — ครั้งแรกลองพิมพ์บนกระดาษธรรมดาแล้วทาบกับแผ่นสติกเกอร์ก่อน
            ตอนพิมพ์ตั้งขนาดเป็น 100% (ไม่ย่อให้พอดีหน้า) และไม่มีขอบ
          </p>
        </section>

        {loadError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>}
        {stickers && stickers.length === 0 && (
          <p className="rounded-2xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-500">
            ยังไม่ได้เลือกชิ้นที่จะพิมพ์ — กลับไปติ๊กเลือกที่หน้ารายการ แล้วกด “พิมพ์สติกเกอร์”
          </p>
        )}
        <div className="flex flex-col items-start gap-4 overflow-x-auto pb-4">{sheets(true)}</div>
      </main>

      {/* The printed copy: a direct child of <body>, the only thing printed. */}
      {mounted &&
        createPortal(
          <div className="inv-label-print">
            <style>{printCss(preset)}</style>
            {sheets(false)}
          </div>,
          document.body
        )}
    </div>
  );
}

function printCss(p: LabelPreset): string {
  return `
@media screen { .inv-label-print { display: none; } }
@media print {
  @page { size: ${p.pageWidthMm}mm ${p.pageHeightMm}mm; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
  body > *:not(.inv-label-print) { display: none !important; }
  .inv-label-print .sheet { break-after: page; page-break-after: always; }
  .inv-label-print .sheet:last-child { break-after: auto; page-break-after: auto; }
}`;
}

function LabelCell({
  preset,
  index,
  sticker,
  qr,
  outline,
}: {
  preset: LabelPreset;
  index: number;
  sticker: Sticker | null;
  qr?: string;
  outline: boolean;
}) {
  const { topMm, leftMm } = labelPosition(preset, index);
  const h = preset.labelHeightMm;
  const pad = Math.min(2, h * 0.07);
  // Type scaled to the sticker: readable on 25 mm, not shouting on 38 mm.
  const codePt = Math.max(7, Math.min(12, h * 0.3));
  const namePt = Math.max(5.5, Math.min(9, h * 0.22));
  const smallPt = Math.max(5, Math.min(7.5, h * 0.18));
  const name = sticker ? sticker.group?.name ?? "" : "";
  const sub = sticker
    ? [sticker.group?.brand, sticker.group?.model, sticker.item.serialNumber && `S/N ${sticker.item.serialNumber}`].filter(Boolean).join(" · ")
    : "";
  return (
    <div
      style={{
        position: "absolute",
        top: `${topMm}mm`,
        left: `${leftMm}mm`,
        width: `${preset.labelWidthMm}mm`,
        height: `${h}mm`,
        padding: `${pad}mm`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: `${pad}mm`,
        overflow: "hidden",
        color: "#111",
        fontFamily: "system-ui, sans-serif",
        ...(outline ? { outline: "1px dashed #d1d5db", outlineOffset: "-1px" } : {}),
      }}
    >
      {sticker && (
        <>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URL made in the browser; nothing to optimise
            <img src={qr} alt="" style={{ height: "100%", aspectRatio: "1 / 1", flexShrink: 0 }} />
          ) : (
            <div style={{ height: "100%", aspectRatio: "1 / 1", flexShrink: 0, background: "#f3f4f6" }} />
          )}
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: `${codePt}pt`, fontWeight: 700, fontFamily: "ui-monospace, monospace", lineHeight: 1.1 }}>
              {sticker.item.code}
            </div>
            <div
              style={{
                fontSize: `${namePt}pt`,
                lineHeight: 1.15,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {name}
            </div>
            {sub && (
              <div style={{ fontSize: `${smallPt}pt`, lineHeight: 1.15, color: "#444", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {sub}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
