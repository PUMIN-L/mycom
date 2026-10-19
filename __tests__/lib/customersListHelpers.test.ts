/**
 * Searching, sorting and naming for the lists on /customers
 * (app/customers/listHelpers.ts).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CUSTOMER_SORT,
  TAB_PARAM,
  anyRecentlyNoted,
  companyLocation,
  matchesCompanySearch,
  matchesCustomerSearch,
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

describe("companyLocation", () => {
  it("joins district and province, skipping what is missing", () => {
    expect(companyLocation({ name: "a", district: "บางรัก", province: "กรุงเทพมหานคร" })).toBe("บางรัก, กรุงเทพมหานคร");
    expect(companyLocation({ name: "a", district: " ", province: "ชลบุรี" })).toBe("ชลบุรี");
    expect(companyLocation({ name: "a", district: "เมือง" })).toBe("เมือง");
    expect(companyLocation({ name: "a" })).toBe("");
  });
});

describe("matchesCompanySearch", () => {
  const co = { name: "Profin Lab", province: "กรุงเทพมหานคร", district: "บางนา" };
  const q = (name = "", province = "", district = "") => ({ name, province, district });

  it("ANDs the three boxes, ignoring case and outer spaces", () => {
    expect(matchesCompanySearch(co, q())).toBe(true);
    expect(matchesCompanySearch(co, q("profin"))).toBe(true);
    expect(matchesCompanySearch(co, q(" lab ", "กรุงเทพ", "บางนา"))).toBe(true);
    expect(matchesCompanySearch(co, q("profin", "ชลบุรี"))).toBe(false);
    expect(matchesCompanySearch(co, q("", "", "บางรัก"))).toBe(false);
  });

  it("does not match a location search against a company with none", () => {
    expect(matchesCompanySearch({ name: "x" }, q("", "กรุงเทพ"))).toBe(false);
    expect(matchesCompanySearch({ name: "x" }, q("x"))).toBe(true);
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
    expect(ids(sortCompanies(list, { key: "location", dir: "asc" }))).toEqual(["3", "2", "5", "1", "4"]);
    expect(ids(sortCompanies(list, { key: "location", dir: "desc" }))).toEqual(["1", "2", "3", "5", "4"]);
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
