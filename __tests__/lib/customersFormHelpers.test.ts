import { describe, it, expect } from "vitest";
import {
  COMPANY_NOTE_MAX,
  CUSTOMER_NOTE_MAX,
  SALESPERSON_NOTE_MAX,
  companyErrors,
  customerErrors,
  duplicateCustomers,
  isDraftDirty,
  namesOf,
  provinceOptions,
  salespersonErrors,
  sameNameAs,
  toCompanyDraft,
  toCustomerDraft,
  toSalespersonDraft,
} from "@/app/customers/formHelpers";

describe("drafts", () => {
  it("take each field as text: NULL and missing are empty, a number is its digits", () => {
    expect(toCustomerDraft({ name: "คุณสมชาย", companyId: "co1", department: null, phone: 812345678, note: undefined })).toEqual({
      name: "คุณสมชาย",
      companyId: "co1",
      department: "",
      phone: "812345678",
      email: "",
      note: "",
    });
  });

  it("keep only the fields the form edits", () => {
    expect(toSalespersonDraft({ id: "sp1", name: "ก", createdAt: "x" })).toEqual({ name: "ก", phone: "", email: "", note: "" });
    expect(Object.keys(toCompanyDraft({ id: "co1", name: "บริษัท", companyName: "x" }))).toEqual([
      "name", "addressNo", "moo", "soi", "road", "subDistrict", "district", "province", "postalCode", "phone", "note",
    ]);
  });

  it("an empty form is all empty strings", () => {
    expect(Object.values(toCompanyDraft())).toEqual(Array(11).fill(""));
    expect(Object.values(toCustomerDraft(null))).toEqual(Array(6).fill(""));
  });
});

describe("isDraftDirty", () => {
  it("is false until a field differs, true after, false again when put back", () => {
    const original = toCustomerDraft({ name: "ก", companyId: "co1" });
    expect(isDraftDirty(original, { ...original })).toBe(false);
    expect(isDraftDirty(original, { ...original, phone: "0" })).toBe(true);
    expect(isDraftDirty(original, { ...original, note: "x" })).toBe(true);
    expect(isDraftDirty(original, { ...original, name: "ก" })).toBe(false);
  });
});

describe("toCompanyDraft — the province by its official name", () => {
  it("opens a company stored as กทม. with กรุงเทพมหานคร, and leaves an unknown one alone", () => {
    expect(toCompanyDraft({ name: "ก", province: "กทม." }).province).toBe("กรุงเทพมหานคร");
    expect(toCompanyDraft({ name: "ก", province: "จ.ชลบุรี" }).province).toBe("ชลบุรี");
    expect(toCompanyDraft({ name: "ก", province: "Osaka" }).province).toBe("Osaka");
    expect(toCompanyDraft({ name: "ก" }).province).toBe("");
  });
});

describe("what is wrong with a form", () => {
  const company = toCompanyDraft({ name: "บริษัท ก" });
  const customer = toCustomerDraft({ name: "คุณ ก", companyId: "co1" });
  const salesperson = toSalespersonDraft({ name: "คุณ ข" });

  it("nothing, when it is fine", () => {
    expect(companyErrors(company)).toEqual({});
    expect(customerErrors(customer)).toEqual({});
    expect(salespersonErrors(salesperson)).toEqual({});
    expect(customerErrors({ ...customer, email: " a.b@example.co.th " })).toEqual({});
  });

  it("a missing name — spaces are not a name", () => {
    expect(companyErrors({ ...company, name: "  " })).toEqual({ name: "กรุณากรอกชื่อบริษัท" });
    expect(customerErrors({ ...customer, name: "" })).toEqual({ name: "กรุณากรอกชื่อลูกค้า" });
    expect(salespersonErrors({ ...salesperson, name: " " })).toEqual({ name: "กรุณากรอกชื่อพนักงานขาย" });
  });

  it("no company chosen", () => {
    expect(customerErrors({ ...customer, companyId: "" })).toEqual({ companyId: "กรุณาเลือกบริษัท" });
  });

  it("a company that is no longer on the list counts as none — unless there is no list to go by", () => {
    const list = [{ id: "co1" }, { id: "co2" }];
    expect(customerErrors(customer, list)).toEqual({});
    expect(customerErrors({ ...customer, companyId: "gone" }, list).companyId).toBe(
      "บริษัทเดิมของลูกค้ารายนี้ไม่อยู่ในรายการแล้ว กรุณาเลือกบริษัท"
    );
    expect(customerErrors({ ...customer, companyId: "gone" }, [])).toEqual({});
  });

  it("an e-mail that is not one", () => {
    for (const bad of ["somchai", "a@b", "a b@c.d", "@c.d", "a@.d"]) {
      expect(customerErrors({ ...customer, email: bad }).email).toMatch(/^รูปแบบอีเมลไม่ถูกต้อง/);
      expect(salespersonErrors({ ...salesperson, email: bad }).email).toMatch(/^รูปแบบอีเมลไม่ถูกต้อง/);
    }
  });

  it("a note longer than its column — each form's own size", () => {
    expect(companyErrors({ ...company, note: "ก".repeat(COMPANY_NOTE_MAX) })).toEqual({});
    expect(companyErrors({ ...company, note: "ก".repeat(COMPANY_NOTE_MAX + 1) }).note).toContain("2,000");
    expect(customerErrors({ ...customer, note: "ก".repeat(CUSTOMER_NOTE_MAX) })).toEqual({});
    expect(customerErrors({ ...customer, note: "ก".repeat(CUSTOMER_NOTE_MAX + 1) }).note).toContain("บันทึกลูกค้ายาวเกิน 2,000");
    expect(salespersonErrors({ ...salesperson, note: "ก".repeat(SALESPERSON_NOTE_MAX) })).toEqual({});
    expect(salespersonErrors({ ...salesperson, note: "ก".repeat(SALESPERSON_NOTE_MAX + 1) }).note).toContain("5,000");
  });

  it("lists problems in the order of the fields", () => {
    expect(Object.keys(customerErrors({ ...customer, name: "", companyId: "", email: "x", note: "ก".repeat(2001) }))).toEqual([
      "name", "companyId", "email", "note",
    ]);
  });
});

describe("sameNameAs", () => {
  const list = [
    { id: "1", name: "บริษัท ไทยแล็บ จำกัด" },
    { id: "2", name: "Thai-Lab Co., Ltd." },
    { id: "3", name: "ร้าน ก" },
  ];
  it("finds the same name whatever the case, spaces and punctuation", () => {
    expect(sameNameAs(list, "บริษัทไทยแล็บ  จำกัด").map((c) => c.id)).toEqual(["1"]);
    expect(sameNameAs(list, "thai lab co ltd").map((c) => c.id)).toEqual(["2"]);
    expect(sameNameAs(list, "ไทยแล็บ")).toEqual([]);
  });
  it("leaves out the one being edited, and an empty name matches nobody", () => {
    expect(sameNameAs(list, "ร้าน ก", "3")).toEqual([]);
    expect(sameNameAs(list, "ร้าน ก", "1").map((c) => c.id)).toEqual(["3"]);
    expect(sameNameAs([{ id: "9", name: "" }], "  ")).toEqual([]);
  });
});

describe("duplicateCustomers", () => {
  const list = [
    { id: "1", name: "คุณสมชาย ใจดี", companyId: "co1", phone: "081-234-5678" },
    { id: "2", name: "คุณสมชาย ใจดี", companyId: "co2", phone: "" },
    { id: "3", name: "คุณวิภา", companyId: "co1", phone: "02-123-4567 ต่อ 12, 0899999999" },
  ];
  const ids = (found: { id: string }[]) => found.map((c) => c.id);

  it("the same name counts only within the same company", () => {
    expect(ids(duplicateCustomers(list, { name: "คุณ สมชาย ใจดี", companyId: "co1", phone: "" }).sameName)).toEqual(["1"]);
    expect(ids(duplicateCustomers(list, { name: "คุณสมชาย ใจดี", companyId: "co3", phone: "" }).sameName)).toEqual([]);
    expect(ids(duplicateCustomers(list, { name: "คุณสมชาย ใจดี", companyId: "", phone: "" }).sameName)).toEqual([]);
  });

  it("the same phone is found however either was typed, one number of several included", () => {
    expect(ids(duplicateCustomers(list, { name: "ใหม่", companyId: "co9", phone: "0812345678" }).samePhone)).toEqual(["1"]);
    expect(ids(duplicateCustomers(list, { name: "ใหม่", companyId: "co9", phone: "+66 81 234 5678" }).samePhone)).toEqual(["1"]);
    expect(ids(duplicateCustomers(list, { name: "ใหม่", companyId: "co9", phone: "089-999-9999" }).samePhone)).toEqual(["3"]);
    expect(ids(duplicateCustomers(list, { name: "ใหม่", companyId: "co9", phone: "021234567" }).samePhone)).toEqual(["3"]);
    // Not a number, or none: nobody.
    expect(ids(duplicateCustomers(list, { name: "ใหม่", companyId: "co9", phone: "1234" }).samePhone)).toEqual([]);
    expect(ids(duplicateCustomers(list, { name: "ใหม่", companyId: "co9", phone: "" }).samePhone)).toEqual([]);
  });

  it("never the one being edited", () => {
    const found = duplicateCustomers(list, { name: "คุณสมชาย ใจดี", companyId: "co1", phone: "0812345678" }, "1");
    expect(found.sameName).toEqual([]);
    expect(found.samePhone).toEqual([]);
  });
});

describe("namesOf", () => {
  it("names up to three, then counts the rest", () => {
    const list = ["ก", "ข", "ค", "ง", "จ"].map((name) => ({ name }));
    expect(namesOf(list.slice(0, 2))).toBe("ก, ข");
    expect(namesOf(list.slice(0, 3))).toBe("ก, ข, ค");
    expect(namesOf(list)).toBe("ก, ข, ค และอีก 2 ราย");
  });
});

describe("provinceOptions", () => {
  it("is 'none' and the 77 provinces", () => {
    const options = provinceOptions("");
    expect(options).toHaveLength(78);
    expect(options[0]).toEqual({ value: "", label: "— ไม่ระบุ —" });
    expect(options[1].value).toBe("กรุงเทพมหานคร");
    expect(provinceOptions("ชลบุรี")).toHaveLength(78);
  });

  it("keeps a stored value that is none of them, marked, so opening the form does not drop it", () => {
    const options = provinceOptions("Osaka");
    expect(options).toHaveLength(79);
    expect(options[1]).toEqual({ value: "Osaka", label: "Osaka (ที่พิมพ์ไว้เดิม)" });
  });
});
