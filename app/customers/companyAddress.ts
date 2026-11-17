// A company's address as it is read and copied on /customers. Pure — the
// company window renders it, the tests pin it.
//
// The form stores the address in parts (เลขที่, หมู่, ซอย, ถนน, ตำบล/แขวง,
// อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์), each as the admin typed it. This puts them
// back together the way an address is written: the right word in front of
// each part ("แขวง … เขต …" in Bangkok, "ตำบล … อำเภอ … จังหวัด …" elsewhere),
// no word twice when the admin already typed it ("ต.บางพลี"), and no empty
// lines for the parts that are missing.

import { provinceName } from "../lib/thaiProvinces";

export interface AddressParts {
  addressNo?: string | null;
  moo?: string | null;
  soi?: string | null;
  road?: string | null;
  subDistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
}

/** กรุงเทพมหานคร, however it was typed — its parts are แขวง / เขต, and it
 *  takes no "จังหวัด" in front. */
export function isBangkok(province: string | null | undefined): boolean {
  return /กรุงเทพ|กทม|bangkok|\bbkk\b/i.test(province || "");
}

const clean = (value: string | null | undefined) => (value || "").trim().replace(/\s+/g, " ");

/**
 * `value` with `word` in front — unless it already starts with that word (or
 * its abbreviation), as typed: "ต.บางพลี" stays "ต.บางพลี", not "ตำบลต.บางพลี".
 * `gap` is what goes between the word and the value ("หมู่ 3", "ตำบลบางนา").
 */
function labelled(value: string, word: string, already: RegExp, gap = ""): string {
  if (!value) return "";
  return already.test(value) ? value : `${word}${gap}${value}`;
}

/**
 * An address outside Thailand: its "province" is written without a Thai
 * letter and is not Bangkok in English. Its parts are joined as typed —
 * "อำเภอYodogawa-ku จังหวัดOsaka" helps nobody.
 */
function isAbroad(province: string): boolean {
  return province !== "" && !/[\u0E00-\u0E7F]/.test(province) && !isBangkok(province);
}

/** The address, one written line per entry; empty when no part is filled in. */
export function companyAddressLines(c: AddressParts): string[] {
  if (isAbroad(clean(c.province))) {
    return [
      [c.addressNo, c.moo, c.soi, c.road],
      [c.subDistrict, c.district],
      [c.province, c.postalCode],
    ]
      .map((parts) => parts.map(clean).filter(Boolean).join(" "))
      .filter(Boolean);
  }
  const bangkok = isBangkok(c.province);
  const street = [
    labelled(clean(c.addressNo), "เลขที่", /^(เลขที่|no\.|อาคาร|ตึก)/i, " "),
    labelled(clean(c.moo), "หมู่", /^(หมู่|ม\.)/, " "),
    labelled(clean(c.soi), "ซอย", /^(ซอย|ซ\.|soi\b)/i),
    labelled(clean(c.road), "ถนน", /^(ถนน|ถ\.)/),
  ];
  const area = [
    labelled(clean(c.subDistrict), bangkok ? "แขวง" : "ตำบล", /^(ตำบล|ต\.|แขวง)/),
    labelled(clean(c.district), bangkok ? "เขต" : "อำเภอ", /^(อำเภอ|อ\.|เขต)/),
  ];
  // By its official name when it is a known province typed another way
  // ("กทม." → กรุงเทพมหานคร, "จ.ชลบุรี" → จังหวัดชลบุรี).
  const province = clean(provinceName(c.province));
  const city = [bangkok ? province : labelled(province, "จังหวัด", /^(จังหวัด|จ\.)/), clean(c.postalCode)];
  return [street, area, city].map((parts) => parts.filter(Boolean).join(" ")).filter(Boolean);
}

/** The address on one line, for the clipboard. */
export function companyAddressText(c: AddressParts): string {
  return companyAddressLines(c).join(" ");
}
