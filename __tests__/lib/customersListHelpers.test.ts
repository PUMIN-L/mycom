/**
 * Searching, sorting and naming for the lists on /customers
 * (app/customers/listHelpers.ts).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CUSTOMER_SORT,
  TAB_PARAM,
  anyRecentlyNoted,
  companyDistrict,
  companyProvince,
  companySalespersonName,
  countCustomersByCompany,
  matchesCompanySearch,
  matchesCustomerSearch,
  matchesSalespersonSearch,
  nextSort,
  searchWithTab,
  sortByName,
  sortCompanies,
  sortCustomers,
  thCompare,
} from "@/app/customers/listHelpers";
import type { Customer } from "@/app/lib/types";

function customer(id: string, over: Partial<Customer> = {}): Customer {
  return {
    id,
    companyId: "co1",
    companyName: "",
    name: id,
    department: "",
    phone: "",
    email: "",
    note: "",
    createdAt: "2025-01-01T00:00:00.000Z",
    noteUpdatedAt: null,
    ...over,
  };
}

const ids = (list: { id: string }[]) => list.map((c) => c.id);
const names = (list: { name: string }[]) => list.map((c) => c.name);

describe("thCompare", () => {
  it("sorts Thai in dictionary order and numbers as numbers", () => {
    expect(["ค", "ก", "ข"].sort(thCompare)).toEqual(["ก", "ข", "ค"]);
    expect(["ร้าน 10", "ร้าน 2", "ร้าน 1"].sort(thCompare)).toEqual(["ร้าน 1", "ร้าน 2", "ร้าน 10"]);
  });

  it("ignores case and treats a missing value as empty", () => {
    expect(thCompare("abc", "ABC")).toBe(0);
    expect(thCompare(undefined as unknown as string, "")).toBe(0);
    expect(thCompare("", "ก")).toBeLessThan(0);
  });
});

describe("matchesCustomerSearch", () => {
  const somchai = customer("c1", {
    name: "คุณสมชาย ใจดี",
    companyName: "บริษัท แล็บ จำกัด",
    email: "Somchai@Example.co.th",
    phone: "0812345678",
  });

  it("matches everyone on an empty or blank query", () => {
    expect(matchesCustomerSearch(somchai, "")).toBe(true);
    expect(matchesCustomerSearch(somchai, "   ")).toBe(true);
  });

  it("matches by name, company or e-mail, ignoring case and outer spaces", () => {
    expect(matchesCustomerSearch(somchai, "สมชาย")).toBe(true);
    expect(matchesCustomerSearch(somchai, "  แล็บ ")).toBe(true);
    expect(matchesCustomerSearch(somchai, "somchai@example")).toBe(true);
    expect(matchesCustomerSearch(somchai, "สมหญิง")).toBe(false);
  });

  it("matches a phone by its digits, however it is typed", () => {
    expect(matchesCustomerSearch(somchai, "081-234-5678")).toBe(true);
    expect(matchesCustomerSearch(somchai, "081 234")).toBe(true);
    expect(matchesCustomerSearch(somchai, "(081) 234.5678")).toBe(true);
    expect(matchesCustomerSearch(somchai, "5678")).toBe(true);
    expect(matchesCustomerSearch(somchai, "0899999999")).toBe(false);
  });

  it("reads +66 as the leading 0", () => {
    expect(matchesCustomerSearch(somchai, "+66 81 234 5678")).toBe(true);
    expect(matchesCustomerSearch(somchai, "+6681234")).toBe(true);
  });

  it("needs three digits before it looks at the phone", () => {
    expect(matchesCustomerSearch(somchai, "8")).toBe(false);
    expect(matchesCustomerSearch(somchai, "81")).toBe(false);
    expect(matchesCustomerSearch(somchai, "812")).toBe(true);
  });

  it("does not read the digits of a WORD query as a phone", () => {
    const shop = customer("c2", { name: "ร้านเอ", phone: "022024111" });
    // "2024" is in the phone, but "ร้าน 2024" is a name search.
    expect(matchesCustomerSearch(shop, "ร้าน 2024")).toBe(false);
    expect(matchesCustomerSearch(shop, "2024")).toBe(true);
  });

  it("copes with missing fields", () => {
    const bare = { name: "ก", companyName: undefined, email: "", phone: "" } as unknown as Customer;
    expect(matchesCustomerSearch(bare, "ก")).toBe(true);
    expect(matchesCustomerSearch(bare, "123")).toBe(false);
  });
});

describe("sortCustomers", () => {
  // n1 noted most recently, then n2; e1 / e2 have no note (e2 newer).
  const list = [
    customer("e1", { name: "ข", companyName: "บ", createdAt: "2025-01-01T00:00:00Z" }),
    customer("n2", { name: "ค", companyName: "ก", note: "x", noteUpdatedAt: "2026-01-01T00:00:00Z" }),
    customer("e2", { name: "ก", companyName: "", createdAt: "2025-06-01T00:00:00Z" }),
    customer("n1", { name: "ง", companyName: "ข", note: "y", noteUpdatedAt: "2026-02-01T00:00:00Z" }),
  ];

  it("defaults to the note order: most recently noted first, no note last", () => {
    expect(DEFAULT_CUSTOMER_SORT).toEqual({ key: "activity", dir: "desc" });
    expect(ids(sortCustomers(list, DEFAULT_CUSTOMER_SORT))).toEqual(["n1", "n2", "e2", "e1"]);
  });

  it("flips the noted customers for oldest-first, but keeps no-note customers last", () => {
    expect(ids(sortCustomers(list, { key: "activity", dir: "asc" }))).toEqual(["n2", "n1", "e2", "e1"]);
  });

  it("sorts by name both ways", () => {
    expect(names(sortCustomers(list, { key: "name", dir: "asc" }))).toEqual(["ก", "ข", "ค", "ง"]);
    expect(names(sortCustomers(list, { key: "name", dir: "desc" }))).toEqual(["ง", "ค", "ข", "ก"]);
  });

  it("sorts by company, a customer without one LAST either way, ties in note order", () => {
    const tie = [...list, customer("n3", { name: "จ", companyName: "ก", note: "z", noteUpdatedAt: "2026-03-01T00:00:00Z" })];
    // n3 and n2 share company "ก": n3 was noted later, so it leads.
    expect(ids(sortCustomers(tie, { key: "company", dir: "asc" }))).toEqual(["n3", "n2", "n1", "e1", "e2"]);
    expect(ids(sortCustomers(tie, { key: "company", dir: "desc" }))).toEqual(["e1", "n1", "n3", "n2", "e2"]);
  });

  it("treats a missing company as blank", () => {
    const loose = [customer("x", { companyName: undefined }), customer("y", { companyName: "ก" })];
    expect(ids(sortCustomers(loose, { key: "company", dir: "asc" }))).toEqual(["y", "x"]);
    expect(ids(sortCustomers(loose, { key: "company", dir: "desc" }))).toEqual(["y", "x"]);
  });

  it("never touches the array it was given", () => {
    const before = ids(list);
    sortCustomers(list, { key: "name", dir: "asc" });
    sortCustomers(list, { key: "activity", dir: "asc" });
    expect(ids(list)).toEqual(before);
  });
});

describe("companyProvince / companyDistrict — the two columns", () => {
  it("each on its own, trimmed, '' when missing", () => {
    const co = { name: "a", district: " บางรัก ", province: "กรุงเทพมหานคร" };
    expect(companyProvince(co)).toBe("กรุงเทพมหานคร");
    expect(companyDistrict(co)).toBe("บางรัก");
    expect(companyProvince({ name: "a", district: "เมือง" })).toBe("");
    expect(companyDistrict({ name: "a", district: " ", province: "ชลบุรี" })).toBe("");
    expect(companyDistrict({ name: "a" })).toBe("");
  });
});

describe("companySalespersonName", () => {
  const names = new Map([["sp1", "คุณวิชัย"]]);
  it("the name of the one who looks after it, '' for nobody or someone no longer listed", () => {
    expect(companySalespersonName({ name: "a", salespersonId: "sp1" }, names)).toBe("คุณวิชัย");
    expect(companySalespersonName({ name: "a", salespersonId: null }, names)).toBe("");
    expect(companySalespersonName({ name: "a" }, names)).toBe("");
    expect(companySalespersonName({ name: "a", salespersonId: "sp-gone" }, names)).toBe("");
  });
});

describe("matchesCompanySearch — the salesperson's name too", () => {
  it("finds a company by who looks after it, word by word with the rest", () => {
    const co = { name: "Profin Lab", province: "ชลบุรี" };
    expect(matchesCompanySearch(co, "วิชัย", "คุณวิชัย")).toBe(true);
    expect(matchesCompanySearch(co, "วิชัย ชลบุรี", "คุณวิชัย")).toBe(true);
    expect(matchesCompanySearch(co, "วิชัย")).toBe(false);
    expect(matchesCompanySearch(co, "สมศรี", "คุณวิชัย")).toBe(false);
  });
});

describe("matchesCompanySearch — one box for name, address and phone", () => {
  const co = {
    name: "Profin Lab",
    subDistrict: "บางนาเหนือ",
    district: "บางนา",
    province: "กรุงเทพมหานคร",
    postalCode: "10260",
    phone: "02-123-4567 ต่อ 105, 081-234-5678",
  };

  it("matches everything on an empty query, and any one field by itself", () => {
    expect(matchesCompanySearch(co, "")).toBe(true);
    expect(matchesCompanySearch(co, "  ")).toBe(true);
    expect(matchesCompanySearch(co, "PROFIN")).toBe(true);
    expect(matchesCompanySearch(co, " lab ")).toBe(true);
    expect(matchesCompanySearch(co, "กรุงเทพ")).toBe(true);
    expect(matchesCompanySearch(co, "บางนาเหนือ")).toBe(true);
    expect(matchesCompanySearch(co, "10260")).toBe(true);
    expect(matchesCompanySearch(co, "ชลบุรี")).toBe(false);
  });

  it("needs every word, each anywhere — what the three boxes did together", () => {
    expect(matchesCompanySearch(co, "lab กรุงเทพ")).toBe(true);
    expect(matchesCompanySearch(co, "lab   บางนา   กรุงเทพ")).toBe(true);
    expect(matchesCompanySearch(co, "profin ชลบุรี")).toBe(false);
  });

  it("finds each number of the phone by its digits", () => {
    expect(matchesCompanySearch(co, "021234567")).toBe(true);
    expect(matchesCompanySearch(co, "081 234 5678")).toBe(true);
    // The digits of two numbers are not one number.
    expect(matchesCompanySearch(co, "1050812")).toBe(false);
  });

  it("copes with a company with no address or phone", () => {
    expect(matchesCompanySearch({ name: "x" }, "กรุงเทพ")).toBe(false);
    expect(matchesCompanySearch({ name: "x" }, "x")).toBe(true);
    expect(matchesCompanySearch({ name: "x" }, "0812")).toBe(false);
  });
});

describe("one-letter words", () => {
  it("must start a word: บริษัท ก is not every name that holds a ก", () => {
    const a = { name: "บริษัท ก" };
    const b = { name: "บริษัท ข", district: "ลูกค้า" };
    expect(matchesCompanySearch(a, "บริษัท ก")).toBe(true);
    expect(matchesCompanySearch(b, "บริษัท ก")).toBe(false);
  });

  it("ร้าน 5 is ร้าน 5…, not ร้าน 05 or ร้าน 15", () => {
    expect(matchesCompanySearch({ name: "ร้าน 50" }, "ร้าน 5")).toBe(true);
    expect(matchesCompanySearch({ name: "ร้าน 05" }, "ร้าน 5")).toBe(false);
    expect(matchesCompanySearch({ name: "ร้าน 15" }, "ร้าน 5")).toBe(false);
    // …but it may start a word in another field.
    expect(matchesCompanySearch({ name: "ร้าน ทอง", district: "5 แยก" }, "ร้าน 5")).toBe(true);
  });

  it("a query of ONE word is matched anywhere, number or not", () => {
    expect(matchesCompanySearch({ name: "ร้าน 145" }, "45")).toBe(true);
    expect(matchesCompanySearch({ name: "บริษัท กขค" }, "ข")).toBe(true);
  });

  it("so must a number: ลูกค้า 00 is not ลูกค้า 100", () => {
    expect(matchesCustomerSearch(customer("a", { name: "ลูกค้า 001" }), "ลูกค้า 00")).toBe(true);
    expect(matchesCustomerSearch(customer("b", { name: "ลูกค้า 100" }), "ลูกค้า 00")).toBe(false);
    // A word of letters may sit inside another: Thai runs them together.
    expect(matchesCustomerSearch(customer("c", { name: "คุณสมชาย", department: "ฝ่ายQC" }), "สมชาย QC")).toBe(true);
  });
});

describe("matchesCustomerSearch — department and words across fields", () => {
  const c = customer("c1", {
    name: "คุณสมชาย ใจดี",
    companyName: "บริษัท แล็บ จำกัด",
    department: "QC",
    email: "somchai@example.co.th",
    phone: "+66 81 234 5678",
  });

  it("finds a customer by department, and by words from different fields", () => {
    expect(matchesCustomerSearch(c, "qc")).toBe(true);
    expect(matchesCustomerSearch(c, "สมชาย QC")).toBe(true);
    expect(matchesCustomerSearch(c, "แล็บ ใจดี")).toBe(true);
    expect(matchesCustomerSearch(c, "สมชาย จัดซื้อ")).toBe(false);
  });

  it("reads a phone stored with +66 as the 0 number it is", () => {
    expect(matchesCustomerSearch(c, "0812345678")).toBe(true);
    expect(matchesCustomerSearch(c, "081-234")).toBe(true);
  });
});

describe("matchesSalespersonSearch", () => {
  const s = { name: "คุณวิชัย ขายดี", email: "wichai@example.com", phone: "086-111-1111" };
  it("by name, e-mail or phone", () => {
    expect(matchesSalespersonSearch(s, "")).toBe(true);
    expect(matchesSalespersonSearch(s, "วิชัย")).toBe(true);
    expect(matchesSalespersonSearch(s, "WICHAI@")).toBe(true);
    expect(matchesSalespersonSearch(s, "0861111111")).toBe(true);
    expect(matchesSalespersonSearch(s, "สมชาย")).toBe(false);
    expect(matchesSalespersonSearch({ name: "ก" }, "123")).toBe(false);
  });
});

describe("countCustomersByCompany", () => {
  it("counts customers per company id, skipping those with none", () => {
    const counts = countCustomersByCompany([{ companyId: "a" }, { companyId: "b" }, { companyId: "a" }, { companyId: "" }, {}]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.size).toBe(2);
  });
});

describe("sortCompanies", () => {
  const list = [
    { id: "1", name: "ค", province: "ชลบุรี", district: "เมือง" },
    { id: "4", name: "ง" },
    { id: "2", name: "ก", province: "กรุงเทพมหานคร", district: "บางนา" },
    { id: "5", name: "จ", province: "กรุงเทพมหานคร", district: " " },
    { id: "3", name: "ข", province: "กรุงเทพมหานคร", district: "บางกะปิ" },
  ];

  it("keeps the API's order until a header is clicked", () => {
    const out = sortCompanies(list, null);
    expect(ids(out)).toEqual(["1", "4", "2", "5", "3"]);
    expect(out).not.toBe(list);
  });

  it("sorts by name both ways", () => {
    expect(ids(sortCompanies(list, { key: "name", dir: "asc" }))).toEqual(["2", "3", "1", "4", "5"]);
    expect(ids(sortCompanies(list, { key: "name", dir: "desc" }))).toEqual(["5", "4", "1", "3", "2"]);
  });

  it("sorts by province, then district within it — blanks last either way", () => {
    expect(ids(sortCompanies(list, { key: "province", dir: "asc" }))).toEqual(["3", "2", "5", "1", "4"]);
    expect(ids(sortCompanies(list, { key: "province", dir: "desc" }))).toEqual(["1", "2", "3", "5", "4"]);
  });

  it("sorts by district, then province — blanks last either way", () => {
    // บางกะปิ, บางนา, เมือง; then the two with no district: 5 has a province, 4 has none.
    expect(ids(sortCompanies(list, { key: "district", dir: "asc" }))).toEqual(["3", "2", "1", "5", "4"]);
    expect(ids(sortCompanies(list, { key: "district", dir: "desc" }))).toEqual(["1", "2", "3", "5", "4"]);
  });

  it("sorts by salesperson name, ties by company name — nobody last either way", () => {
    const people = [
      { id: "1", name: "ค", salespersonId: "b" },
      { id: "2", name: "ก" },
      { id: "3", name: "ข", salespersonId: "a" },
      { id: "4", name: "ง", salespersonId: "b" },
      { id: "5", name: "จ", salespersonId: "gone" },
    ];
    const names = new Map([["a", "คุณกมล"], ["b", "คุณวิชัย"]]);
    // กมล (3); วิชัย: ค (1) before ง (4); then nobody: ก (2), จ (5, not listed).
    expect(ids(sortCompanies(people, { key: "salesperson", dir: "asc" }, undefined, names))).toEqual(["3", "1", "4", "2", "5"]);
    expect(ids(sortCompanies(people, { key: "salesperson", dir: "desc" }, undefined, names))).toEqual(["1", "4", "3", "2", "5"]);
  });

  it("sorts by how many customers each has, ties by name", () => {
    const counts = new Map([["1", 3], ["2", 1], ["3", 3]]);
    // 1 (ค) and 3 (ข) both have 3: ข before ค either way.
    expect(ids(sortCompanies(list, { key: "customers", dir: "desc" }, counts))).toEqual(["3", "1", "2", "4", "5"]);
    expect(ids(sortCompanies(list, { key: "customers", dir: "asc" }, counts))).toEqual(["4", "5", "2", "3", "1"]);
    // No counts given: everyone has none, so by name.
    expect(ids(sortCompanies(list, { key: "customers", dir: "desc" }))).toEqual(["2", "3", "1", "4", "5"]);
  });
});

describe("sortByName", () => {
  it("leaves the order alone without a sort, sorts by name with one", () => {
    const list = [{ name: "ข" }, { name: "ก" }];
    expect(names(sortByName(list, null))).toEqual(["ข", "ก"]);
    expect(names(sortByName(list, { key: "name", dir: "asc" }))).toEqual(["ก", "ข"]);
    expect(names(sortByName(list, { key: "name", dir: "desc" }))).toEqual(["ข", "ก"]);
    expect(names(list)).toEqual(["ข", "ก"]);
  });
});

describe("nextSort", () => {
  it("starts a new column in its first direction and flips the same column", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "desc" }, "company")).toEqual({ key: "company", dir: "asc" });
    expect(nextSort<"name" | "activity">({ key: "name", dir: "asc" }, "activity", "desc")).toEqual({ key: "activity", dir: "desc" });
  });
});

describe("searchWithTab", () => {
  it("writes the tab, and none for the default customers tab", () => {
    expect(searchWithTab("", "companies")).toBe("?tab=companies");
    expect(searchWithTab("?tab=companies", "customers")).toBe("");
    expect(searchWithTab("?tab=companies", "salespeople")).toBe("?tab=salespeople");
  });

  it("uses the equipment spelling the dashboard's link already uses", () => {
    expect(TAB_PARAM.equipments).toBe("equipment");
    expect(searchWithTab("", "equipments")).toBe("?tab=equipment");
  });

  it("drops a deep link's one-shot parameters and keeps anything else", () => {
    expect(searchWithTab("?customerId=c1&utm=x", "companies")).toBe("?utm=x&tab=companies");
    expect(searchWithTab("?tab=equipment&edit_eq=e1&action=view", "salespeople")).toBe("?tab=salespeople");
    expect(searchWithTab("?equipmentId=e1&customer=c&id=9", "customers")).toBe("");
  });
});

describe("anyRecentlyNoted", () => {
  it("is true only when some customer WITH a note passes the check", () => {
    const noted = customer("a", { note: "x", noteUpdatedAt: "2026-01-01T00:00:00Z" });
    const bare = customer("b");
    expect(anyRecentlyNoted([bare, noted], () => true)).toBe(true);
    expect(anyRecentlyNoted([bare, noted], () => false)).toBe(false);
    expect(anyRecentlyNoted([bare], () => true)).toBe(false);
    expect(anyRecentlyNoted([], () => true)).toBe(false);
  });
});

describe("provinces by any of their names", () => {
  const bkk = { id: "1", name: "บริษัท หนึ่ง", district: "บางนา", province: "กทม." };
  const official = { id: "2", name: "บริษัท สอง", district: "ลาดพร้าว", province: "กรุงเทพมหานคร" };
  const chon = { id: "3", name: "บริษัท สาม", district: "ศรีราชา", province: "จ.ชลบุรี" };

  it("a search finds Bangkok whichever way it was stored or is typed", () => {
    for (const query of ["กทม", "กรุงเทพ", "กรุงเทพมหานคร", "bangkok"]) {
      expect(matchesCompanySearch(bkk, query)).toBe(true);
      expect(matchesCompanySearch(official, query)).toBe(true);
      expect(matchesCompanySearch(chon, query)).toBe(false);
    }
    expect(matchesCompanySearch(chon, "ชลบุรี")).toBe(true);
  });

  it("the list shows the official name", () => {
    expect(companyProvince(bkk)).toBe("กรุงเทพมหานคร");
    expect(companyProvince(chon)).toBe("ชลบุรี");
    expect(companyProvince({ name: "x", province: "Osaka" })).toBe("Osaka");
  });

  it("sorting by province puts the same province together, however it was typed", () => {
    const krabi = { id: "4", name: "บริษัท สี่", district: "เมือง", province: "กระบี่" };
    // กระบี่, then both Bangkok rows (บางนา before ลาดพร้าว), then ชลบุรี. By the
    // stored text, "กทม." would sort ahead of กระบี่ and apart from กรุงเทพมหานคร.
    expect(ids(sortCompanies([chon, official, krabi, bkk], { key: "province", dir: "asc" }))).toEqual(["4", "1", "2", "3"]);
  });
});
