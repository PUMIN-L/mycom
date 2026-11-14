// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DELETE_LIST_MAX,
  SESSION_EXPIRED_MESSAGE,
  deleteConfirmMessage,
  digitsOf,
  errorMessageOf,
  findDuplicateSuppliers,
  isSupplierDirty,
  linkedProductList,
  linkedProductNames,
  matchesSupplierSearch,
  UNNAMED_PRODUCT,
  missingPoFields,
  normalizeCompanyName,
  sortSuppliers,
  supplierErrors,
  toSupplierDraft,
} from "@/app/suppliers/supplierHelpers";
import type { Supplier } from "@/app/lib/types";

const supplier = (id: string, patch: Partial<Supplier> = {}): Supplier => ({
  id,
  companyName: `บริษัท ${id} จำกัด`,
  contactName: "",
  phone: "",
  note: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});
const product = (id: string, title_th: string, title_en = "") => ({ id, title_th, title_en });

describe("toSupplierDraft / supplierErrors", () => {
  it("fills every field with a string, an old supplier's missing address and tax ID too", () => {
    expect(toSupplierDraft()).toEqual({ companyName: "", contactName: "", phone: "", taxId: "", address: "", note: "" });
    expect(toSupplierDraft(supplier("a", { phone: "02", address: undefined }))).toEqual({
      companyName: "บริษัท a จำกัด",
      contactName: "",
      phone: "02",
      taxId: "",
      address: "",
      note: "",
    });
  });

  it("is dirty when any field differs from what the form opened with", () => {
    const original = toSupplierDraft(supplier("a", { address: "กรุงเทพฯ" }));
    expect(isSupplierDirty(original, { ...original })).toBe(false);
    for (const field of ["companyName", "contactName", "phone", "taxId", "address", "note"] as const) {
      expect(isSupplierDirty(original, { ...original, [field]: original[field] + "x" })).toBe(true);
    }
  });

  it("asks for a company name — spaces alone are not one", () => {
    expect(supplierErrors(toSupplierDraft())).toEqual({ companyName: "กรุณากรอกชื่อบริษัท" });
    expect(supplierErrors({ ...toSupplierDraft(), companyName: "   " })).toEqual({ companyName: "กรุณากรอกชื่อบริษัท" });
    expect(supplierErrors({ ...toSupplierDraft(), companyName: "ABC" })).toEqual({});
  });
});

describe("findDuplicateSuppliers", () => {
  const list = [
    supplier("imada", { companyName: "IMADA Co., Ltd.", taxId: "0-1055-56123-45-6" }),
    supplier("imada-branch", { companyName: "IMADA (สาขา 1)", taxId: "0105556123456" }),
    supplier("thai", { companyName: "บริษัท  ไทยสเกล  จำกัด" }),
  ];

  it("finds the same name whatever the case, spacing or Co., Ltd. punctuation", () => {
    const found = findDuplicateSuppliers(list, { ...toSupplierDraft(), companyName: "  imada co ltd " });
    expect(found.sameName.map((s) => s.id)).toEqual(["imada"]);
    expect(findDuplicateSuppliers(list, { ...toSupplierDraft(), companyName: "บริษัท ไทยสเกล จำกัด" }).sameName.map((s) => s.id)).toEqual(["thai"]);
  });

  it("finds every supplier with the same tax ID, dashes or not — a head office and its branch", () => {
    const found = findDuplicateSuppliers(list, { ...toSupplierDraft(), companyName: "ใหม่", taxId: "0105556123456" });
    expect(found.sameTaxId.map((s) => s.id)).toEqual(["imada", "imada-branch"]);
    expect(found.sameName).toEqual([]);
  });

  it("never reports the supplier being edited as its own duplicate", () => {
    const draft = toSupplierDraft(list[0]);
    const found = findDuplicateSuppliers(list, draft, "imada");
    expect(found.sameName).toEqual([]);
    expect(found.sameTaxId.map((s) => s.id)).toEqual(["imada-branch"]);
  });

  it("reports nothing for an empty name or tax ID, nor for a different one", () => {
    expect(findDuplicateSuppliers(list, toSupplierDraft())).toEqual({ sameName: [], sameTaxId: [] });
    expect(findDuplicateSuppliers(list, { ...toSupplierDraft(), companyName: "IMADA Japan", taxId: "-" })).toEqual({ sameName: [], sameTaxId: [] });
  });

  it("normalizes names and digits the same way the check does", () => {
    expect(normalizeCompanyName("YASUDA SEIKI SEISAKUSHO, LTD.")).toBe(normalizeCompanyName("yasuda seiki  seisakusho ltd"));
    expect(digitsOf("0-1055-56123-45-6")).toBe("0105556123456");
    expect(digitsOf(undefined)).toBe("");
  });
});

describe("linkedProductNames / deleteConfirmMessage", () => {
  it("names linked products as plain text, as a quotation shows them — an untitled one still counts", () => {
    const s = supplier("a", {
      linkedProducts: [product("p1", "<p>ตู้อบ &amp; ชั้นวาง 🐧</p>"), product("p2", "", "<b>Scale</b>"), product("p3", "<p></p>")],
    });
    expect(linkedProductNames(s)).toEqual(["ตู้อบ & ชั้นวาง", "Scale", UNNAMED_PRODUCT]);
    expect(linkedProductList(s).map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(linkedProductNames(supplier("b"))).toEqual([]);
    // The delete warning counts every link the list's column counts.
    expect(deleteConfirmMessage(s)).toContain("ผูกกับสินค้า 3 รายการ");
  });

  it("without linked products: the name, no way back, and what keeps the old name", () => {
    const message = deleteConfirmMessage(supplier("a"));
    expect(message).toBe('ลบ "บริษัท a จำกัด"? ลบแล้วกู้คืนไม่ได้\n\nใบสั่งซื้อที่ออกไปแล้ว และทรัพย์สิน/สต็อกที่อ้างถึง ยังแสดงชื่อเดิม');
    expect(message).not.toContain("ผูกกับสินค้า");
  });

  it("with linked products: how many, the first few by name, and how many more", () => {
    const names = Array.from({ length: DELETE_LIST_MAX + 2 }, (_, i) => `สินค้า ${i + 1}`);
    const message = deleteConfirmMessage(supplier("a", { linkedProducts: names.map((n, i) => product(`p${i}`, `<p>${n}</p>`)) }));
    expect(message).toContain(`ซัพพลายเออร์นี้ผูกกับสินค้า ${names.length} รายการ`);
    for (const n of names.slice(0, DELETE_LIST_MAX)) expect(message).toContain(`• ${n}\n`);
    expect(message).not.toContain(`• ${names[DELETE_LIST_MAX]}`);
    expect(message).toContain("…และอีก 2 รายการ");
  });

  it("lists exactly the linked products when there are no more than the limit", () => {
    const message = deleteConfirmMessage(supplier("a", { linkedProducts: [product("p1", "<p>A</p>")] }));
    expect(message).toContain("ผูกกับสินค้า 1 รายการ");
    expect(message).toContain("• A");
    expect(message).not.toContain("และอีก");
  });
});

describe("matchesSupplierSearch", () => {
  const imada = supplier("imada", {
    companyName: "บริษัท อิมาดะ  เทคโนโลยี จำกัด",
    contactName: "คุณสมชาย ใจดี",
    phone: "02-123-4567, 081-234-5678",
    taxId: "0-1055-56123-45-6",
    linkedProducts: [product("p1", "<p>เครื่องวัดแรง ZTA-500N &amp; แท่น</p>")],
  });
  const yasuda = supplier("yasuda", { companyName: "YASUDA SEIKI", contactName: "Mr. Tanaka", phone: "+81-6-6421-1234" });
  const find = (q: string) => [imada, yasuda].filter((s) => matchesSupplierSearch(s, q)).map((s) => s.id);

  it("matches everything for an empty search", () => {
    expect(find("")).toEqual(["imada", "yasuda"]);
    expect(find("   ")).toEqual(["imada", "yasuda"]);
  });

  it("finds a supplier by its contact — the name was all it used to search", () => {
    expect(find("tanaka")).toEqual(["yasuda"]);
    expect(find("สมชาย")).toEqual(["imada"]);
  });

  it("finds who sells a product, by the product's plain name", () => {
    expect(find("zta-500n")).toEqual(["imada"]);
    expect(find("ZTA-500N & แท่น")).toEqual(["imada"]);
    expect(find("<p>")).toEqual([]);
  });

  it("finds a phone or tax ID however the digits were written", () => {
    expect(find("081 234")).toEqual(["imada"]);
    expect(find("0812345678")).toEqual(["imada"]);
    expect(find("0105556")).toEqual(["imada"]);
    expect(find("(+81) 6-6421")).toEqual(["yasuda"]);
  });

  it("does not match digits across a word: 'ZTA 500' is a name search, not a number", () => {
    expect(find("ZTA 500")).toEqual([]);
  });

  it("a search of only dashes or brackets finds nothing — not every phone", () => {
    expect(find("- -")).toEqual([]);
    expect(find("()")).toEqual([]);
  });

  it("ignores runs of spaces in the name and in the search", () => {
    expect(find("อิมาดะ เทคโนโลยี")).toEqual(["imada"]);
    expect(find("yasuda   seiki")).toEqual(["yasuda"]);
  });
});

describe("sortSuppliers", () => {
  const list = [
    supplier("b", { companyName: "บริษัท ข", contactName: "", linkedProducts: [product("p1", "x")] }),
    supplier("a", { companyName: "บริษัท ก", contactName: "สมศรี", linkedProducts: [] }),
    supplier("c", { companyName: "ABC", contactName: "Anna", linkedProducts: [product("p1", "x"), product("p2", "y")] }),
    supplier("d", { companyName: "บริษัท ค", contactName: "", linkedProducts: [product("p3", "z")] }),
  ];
  const ids = (out: Supplier[]) => out.map((s) => s.id);

  it("keeps the API's order (newest first) until a header is clicked", () => {
    expect(ids(sortSuppliers(list, null))).toEqual(["b", "a", "c", "d"]);
  });

  // thCompare, as every admin list sorts: Thai names before Latin ones.
  it("sorts names ก→ฮ, A→Z and back", () => {
    expect(ids(sortSuppliers(list, { key: "name", dir: "asc" }))).toEqual(["a", "b", "d", "c"]);
    expect(ids(sortSuppliers(list, { key: "name", dir: "desc" }))).toEqual(["c", "d", "b", "a"]);
  });

  it("sorts contacts with the ones that have none last, either way", () => {
    expect(ids(sortSuppliers(list, { key: "contact", dir: "asc" }))).toEqual(["a", "c", "b", "d"]);
    expect(ids(sortSuppliers(list, { key: "contact", dir: "desc" }))).toEqual(["c", "a", "b", "d"]);
  });

  it("sorts by how many products, ties by name", () => {
    expect(ids(sortSuppliers(list, { key: "products", dir: "desc" }))).toEqual(["c", "b", "d", "a"]);
    expect(ids(sortSuppliers(list, { key: "products", dir: "asc" }))).toEqual(["a", "b", "d", "c"]);
    // A tie given in the other order still comes out by name, ข before ค.
    const [b, , , d] = list;
    expect(ids(sortSuppliers([d, b], { key: "products", dir: "desc" }))).toEqual(["b", "d"]);
  });

  it("never reorders the list it was given", () => {
    sortSuppliers(list, { key: "name", dir: "asc" });
    expect(ids(list)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("missingPoFields", () => {
  it("flags a missing address on every supplier", () => {
    expect(missingPoFields({ companyName: "YASUDA SEIKI", address: "", taxId: "" })).toEqual(["address"]);
    expect(missingPoFields({ companyName: "YASUDA SEIKI", address: "   ", taxId: "" })).toEqual(["address"]);
  });

  it("asks a Thai-named supplier for a tax ID — '-' is none — but not one abroad", () => {
    expect(missingPoFields({ companyName: "บริษัท ก จำกัด", address: "กรุงเทพฯ", taxId: "" })).toEqual(["taxId"]);
    expect(missingPoFields({ companyName: "หจก. ไทยสเกล", address: undefined, taxId: "-" })).toEqual(["address", "taxId"]);
    expect(missingPoFields({ companyName: "COMETECH CO., LTD.", address: "Taichung", taxId: undefined })).toEqual([]);
  });

  it("flags nothing for a supplier ready for a purchase order", () => {
    expect(missingPoFields({ companyName: "บริษัท ก จำกัด", address: "กรุงเทพฯ", taxId: "0105556123456" })).toEqual([]);
  });
});

describe("errorMessageOf", () => {
  const res = (status: number, body: unknown) =>
    ({ status, ok: status < 400, json: async () => (body instanceof Error ? Promise.reject(body) : body) }) as unknown as Response;

  it("says a lapsed session in Thai, never requireAuth's 'Unauthorized'", async () => {
    expect(await errorMessageOf(res(401, { error: "Unauthorized" }), "x")).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("shows the route's own message, or the fallback when it sent none", async () => {
    expect(await errorMessageOf(res(400, { error: "กรุณากรอกชื่อบริษัท" }), "x")).toBe("กรุณากรอกชื่อบริษัท");
    expect(await errorMessageOf(res(500, { error: "  " }), "fallback")).toBe("fallback");
    expect(await errorMessageOf(res(500, {}), "fallback")).toBe("fallback");
    expect(await errorMessageOf(res(502, new Error("not json")), "fallback")).toBe("fallback");
  });
});
