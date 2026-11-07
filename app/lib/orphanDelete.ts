/**
 * The most unused Cloudinary files one delete removes (DELETE
 * /api/cloudinary/orphans — one emailed code each, the files destroyed one by
 * one inside a single request). The route refuses a longer list rather than
 * cutting it short, and /settings never selects more than this.
 *
 * Cutting it short is what it used to do: "เลือกทั้งหมด" on 80 files deleted the
 * first 50, answered "ลบสำเร็จ 50 รูป", and the screen dropped all 80 from the
 * list — 30 files the admin had just "deleted" stayed on Cloudinary.
 */
export const ORPHAN_DELETE_MAX = 50;
