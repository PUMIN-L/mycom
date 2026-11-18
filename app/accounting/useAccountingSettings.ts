"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessageOf } from "../lib/apiErrorMessage";
import type { AccountingSettings } from "../lib/accounting/types";

export type SettingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; settings: AccountingSettings };

/** GET /api/accounting/settings — VAT, default credit, our company (null version = not set up yet). */
export function useAccountingSettings(): { state: SettingsState; retry: () => void } {
  const [state, setState] = useState<SettingsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounting/settings", { cache: "no-store" });
        if (!res.ok) {
          const message = await errorMessageOf(res, "โหลดการตั้งค่าบัญชีไม่สำเร็จ");
          if (!cancelled) setState({ status: "error", message });
          return;
        }
        const settings: AccountingSettings = await res.json();
        if (!cancelled) setState({ status: "ok", settings });
      } catch {
        if (!cancelled) setState({ status: "error", message: "โหลดการตั้งค่าบัญชีไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองใหม่" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}
