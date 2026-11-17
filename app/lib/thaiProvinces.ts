// Thailand's 77 provinces, by their official names — and how to recognise one
// typed any other way. Pure.
//
// The company form used to take the province as free text, so one place was
// stored as "กรุงเทพฯ", "กทม." and "กรุงเทพมหานคร" — three different values to
// a search or a sort. The form now picks from this list; what is already
// stored is matched to it here (never rewritten behind the admin's back).

export const THAI_PROVINCES: readonly string[] = [
  "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร", "ขอนแก่น", "จันทบุรี", "ฉะเชิงเทรา",
  "ชลบุรี", "ชัยนาท", "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง", "ตราด", "ตาก", "นครนายก",
  "นครปฐม", "นครพนม", "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์", "นนทบุรี", "นราธิวาส", "น่าน",
  "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์", "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา",
  "พะเยา", "พังงา", "พัทลุง", "พิจิตร", "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์", "แพร่", "ภูเก็ต",
  "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน", "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง", "ราชบุรี",
  "ลพบุรี", "ลำปาง", "ลำพูน", "เลย", "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
  "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี", "สุโขทัย", "สุพรรณบุรี", "สุราษฎร์ธานี",
  "สุรินทร์", "หนองคาย", "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์", "อุทัยธานี",
  "อุบลราชธานี",
];

/** Other ways a province gets typed, as compared (see `key`). */
const ALIASES: Record<string, string> = {
  กทม: "กรุงเทพมหานคร",
  กรุงเทพ: "กรุงเทพมหานคร",
  กรุงเทพฯ: "กรุงเทพมหานคร",
  bangkok: "กรุงเทพมหานคร",
  bkk: "กรุงเทพมหานคร",
  อยุธยา: "พระนครศรีอยุธยา",
  โคราช: "นครราชสีมา",
};

/** A name as compared: no "จังหวัด" / "จ." in front, no spaces or dots, lower case. */
function key(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(จังหวัด|จ\.)\s*/, "")
    .replace(/[\s.]/g, "");
}

const BY_KEY = new Map<string, string>([
  ...THAI_PROVINCES.map((p) => [key(p), p] as [string, string]),
  ...Object.entries(ALIASES).map(([alias, p]) => [key(alias), p] as [string, string]),
]);

/**
 * The official name of the province `raw` means — "กทม.", "กรุงเทพฯ",
 * "จ.ชลบุรี", " ระยอง " — or null when it is none of them (a typo, a place
 * abroad, nothing).
 */
export function canonicalProvince(raw: string | null | undefined): string | null {
  return BY_KEY.get(key(raw || "")) ?? null;
}

/** The province as shown and compared: its official name when it is known,
 *  else exactly what was typed (trimmed). */
export function provinceName(raw: string | null | undefined): string {
  return canonicalProvince(raw) ?? (raw || "").trim();
}

/**
 * Every way the province `raw` means is written, for a search to match
 * against: a company in "กรุงเทพมหานคร" is found by "กทม" and by "bangkok",
 * and one stored as "กทม." by "กรุงเทพมหานคร". What was typed is always in it.
 */
export function provinceSearchText(raw: string | null | undefined): string {
  const typed = (raw || "").trim();
  const official = canonicalProvince(typed);
  if (!official) return typed;
  const aliases = Object.entries(ALIASES).flatMap(([alias, p]) => (p === official ? [alias] : []));
  return [typed, official, ...aliases].join(" ");
}
