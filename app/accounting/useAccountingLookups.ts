"use client";

import { useEffect, useState } from "react";
import { displayText } from "../lib/stripHtml";

export interface LookupCompany {
  id: string;
  name: string;
  addressNo?: string | null;
  moo?: string | null;
  soi?: string | null;
  road?: string | null;
  subDistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  taxId?: string | null;
  branchCode?: string | null;
  whtPercent?: string | number | null;
}
export interface LookupCustomer {
  id: string;
  name: string;
  companyId: string;
}
export interface LookupPerson {
  id: string;
  name: string;
}
export interface LookupProduct {
  id: string;
  title: string;
}

export interface AccountingLookups {
  status: "loading" | "ok" | "error";
  companies: LookupCompany[];
  customers: LookupCustomer[];
  salespeople: LookupPerson[];
  products: LookupProduct[];
}

/**
 * The lists a document's form picks from — companies (with their tax fields),
 * their contacts, salespeople, catalog products. A failed list leaves the form
 * usable: everything it fills in can be typed by hand.
 */
export function useAccountingLookups(): AccountingLookups {
  const [state, setState] = useState<AccountingLookups>({ status: "loading", companies: [], customers: [], salespeople: [], products: [] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [co, cu, sp, pr] = await Promise.all([
          fetch("/api/companies"),
          fetch("/api/customers?fields=list"),
          fetch("/api/salespeople"),
          fetch("/api/products"),
        ]);
        const read = async (res: Response) => (res.ok ? res.json() : []);
        const [companies, customers, salespeople, productsBody] = await Promise.all([read(co), read(cu), read(sp), read(pr)]);
        const products = Array.isArray(productsBody) ? productsBody : productsBody?.products ?? [];
        if (cancelled) return;
        setState({
          status: co.ok && cu.ok ? "ok" : "error",
          companies: Array.isArray(companies) ? companies : [],
          customers: (Array.isArray(customers) ? customers : []).map((c: Record<string, unknown>) => ({
            id: String(c.id),
            name: String(c.name ?? ""),
            companyId: String(c.companyId ?? ""),
          })),
          salespeople: (Array.isArray(salespeople) ? salespeople : []).map((s: Record<string, unknown>) => ({ id: String(s.id), name: String(s.name ?? "") })),
          products: products.map((p: Record<string, unknown>) => ({
            id: String(p.id),
            title: displayText(String(p.title_th || p.title_en || "")),
          })),
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: "error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
