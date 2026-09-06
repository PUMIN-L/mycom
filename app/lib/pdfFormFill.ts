// pdfFormFill.ts — reading and writing an existing AcroForm, and the ONE place
// that owns the Thai form-appearance sequence.
//
// Bytes in, bytes out. No DOM: no document, window, File, Blob or URL. pdf-lib
// is pulled in with `await import("pdf-lib")` so the ~400KB library stays out
// of every bundle that never edits a PDF (app/lib/xlsxExport.ts is the
// precedent for this in the repo).
//
// ======================================================================
// THE THAI APPEARANCE SEQUENCE — the reason this module exists
// ======================================================================
// A PDF form field stores its value AND a pre-rendered "appearance stream"
// that readers actually paint. pdf-lib regenerates those appearances, and by
// default it does it with Helvetica, which is WinAnsi. That gives three
// possible outcomes, only one of which is correct:
//
//   save()                              → CRASHES on any Thai value, deep
//                                         inside the writer:
//                                         `WinAnsi cannot encode "ท" (0x0e17)`
//   save({updateFieldAppearances:false})→ "succeeds", and the fields are BLANK
//                                         in most readers. The value is in the
//                                         file; nothing draws it. This is the
//                                         dangerous one — it looks like it
//                                         worked.
//   updateFieldAppearances(thaiFont)
//     THEN save({updateFieldAppearances:false})
//                                       → correct.
//
// So the sequence is not a preference, it is the only order that works, and it
// lives in `writeAppearances` below and nowhere else. Every path through this
// module (fill, flatten, and the one applyEdits calls) goes through it.
//
// ======================================================================
// XFA
// ======================================================================
// Older Thai government PDFs are XFA (an XML form layer Adobe bolted on).
// pdf-lib cannot read or write XFA: it lists the underlying AcroForm skeleton,
// which is usually empty or stale, and anything written to it is ignored by
// the reader. Half-filling one of those is worse than refusing, so we refuse.
//
// NOTE THE TRAP: `pdfDoc.getForm()` DELETES the XFA entry and warns to the
// console on its very first call, so `form.hasXFA()` is false by the time you
// would think to ask. The check therefore reads the raw catalog dict BEFORE
// `getForm()` is ever called — see `hasXfaEntry`.

import type { PDFDocument, PDFField, PDFFont, PDFForm } from "pdf-lib";
import type { FormValue } from "./pdfTypes";
import { toBytes, type ByteSource } from "./pdfBytes";
import { loadThaiFont } from "./pdfFonts";

type PdfLib = typeof import("pdf-lib");

let pdfLibPromise: Promise<PdfLib> | undefined;

/** Dynamic, memoised. Keeps pdf-lib out of every unrelated route's bundle. */
export function pdfLib(): Promise<PdfLib> {
  pdfLibPromise ??= import("pdf-lib");
  return pdfLibPromise;
}

/* ------------------------------------------------------------------ *
 * Errors — every message is Thai because the editor shows it verbatim
 * ------------------------------------------------------------------ */

/**
 * The upload is password-protected. pdf-lib 1.17.1 CANNOT DECRYPT — and
 * `ignoreEncryption: true` does not help: it only suppresses the throw and
 * hands back ciphertext, which becomes a file full of garbage. Refusing is the
 * only honest option.
 */
export class PdfEncryptedError extends Error {
  constructor() {
    super(
      "ไฟล์ PDF นี้ตั้งรหัสผ่านไว้ จึงเปิดแก้ไขไม่ได้ " +
        "กรุณาปลดรหัสผ่านออกก่อน แล้วอัปโหลดใหม่อีกครั้ง"
    );
    this.name = "PdfEncryptedError";
  }
}

/** The upload is an XFA form. See the header for why we refuse it. */
export class PdfXfaFormError extends Error {
  constructor() {
    super(
      "ไฟล์ PDF นี้เป็นฟอร์มแบบ XFA ซึ่งเครื่องมือนี้กรอกให้ไม่ได้ " +
        "กรุณาเปิดด้วย Adobe Acrobat เพื่อกรอก หรือสั่งพิมพ์เป็น PDF ธรรมดาก่อน"
    );
    this.name = "PdfXfaFormError";
  }
}

/** The bytes are not a PDF pdf-lib can parse. */
export class PdfOpenError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`เปิดไฟล์ PDF ไม่สำเร็จ — ${detail}`);
    this.name = "PdfOpenError";
    this.detail = detail;
  }
}

/** A value was written to a field name the form does not have. */
export class PdfFormFieldNotFoundError extends Error {
  readonly fieldName: string;
  constructor(fieldName: string) {
    super(`ไม่พบช่องกรอกชื่อ "${fieldName}" ในไฟล์นี้`);
    this.name = "PdfFormFieldNotFoundError";
    this.fieldName = fieldName;
  }
}

/* ------------------------------------------------------------------ *
 * Opening a document
 * ------------------------------------------------------------------ */

/**
 * Load bytes into a pdf-lib document, refusing an encrypted file loudly.
 *
 * `toBytes` gives us a fresh, plain, same-realm `Uint8Array`, which matters:
 * pdf.js TRANSFERS any ArrayBuffer it is handed to its worker, and a detached
 * buffer makes pdf-lib throw "Cannot perform Construct on a detached
 * ArrayBuffer" much later and much less legibly.
 */
export async function openPdfDocument(input: ByteSource): Promise<PDFDocument> {
  const { PDFDocument, EncryptedPDFError } = await pdfLib();
  const bytes = toBytes(input);
  try {
    // ignoreEncryption stays at its default (false) ON PURPOSE.
    return await PDFDocument.load(bytes);
  } catch (err) {
    if (
      err instanceof EncryptedPDFError ||
      (err instanceof Error && /encrypted/i.test(err.message))
    ) {
      throw new PdfEncryptedError();
    }
    throw new PdfOpenError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Does the raw catalog carry an /XFA entry?
 *
 * MUST be asked before `pdfDoc.getForm()`, which silently deletes it. This is
 * the reason we do not simply call `form.hasXFA()` as the first thing.
 */
export async function hasXfaEntry(pdfDoc: PDFDocument): Promise<boolean> {
  const { PDFName, PDFDict } = await pdfLib();
  const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  return !!acroForm && acroForm.has(PDFName.of("XFA"));
}

async function assertNotXfa(pdfDoc: PDFDocument): Promise<void> {
  if (await hasXfaEntry(pdfDoc)) throw new PdfXfaFormError();
}

/* ------------------------------------------------------------------ *
 * Describing the fields
 * ------------------------------------------------------------------ */

export type FormFieldKind =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "optionlist"
  | "button"
  | "signature";

export type FormFieldInfo = {
  /** Fully qualified field name — the key used in `EditModel.formValues`. */
  name: string;
  kind: FormFieldKind;
  readOnly: boolean;
  required: boolean;
  /**
   * The value already in the file, shaped exactly like the `FormValue` the
   * editor will write back. `null` for kinds that hold no fillable value
   * (a push button, a signature).
   */
  value: FormValue | null;
  /** Selectable options — radio, dropdown and option list only. */
  options?: string[];
  /** Text fields only. */
  multiline?: boolean;
  maxLength?: number;
  /** Dropdown / option list only: may more than one option be chosen? */
  multiSelect?: boolean;
  /** A dropdown that also accepts free text. */
  editable?: boolean;
  /**
   * Zero-based indices of the pages this field's widgets sit on, so the editor
   * can jump to a field. Usually one page; empty if the widget is orphaned.
   */
  pageIndices: number[];
};

/**
 * Map every annotation dictionary in the document to the page it lives on, so
 * a field's widgets can be traced back to page numbers. Built once per call —
 * doing it per field would be quadratic on a big government form.
 */
async function buildWidgetPageIndex(
  pdfDoc: PDFDocument
): Promise<Map<unknown, number>> {
  const { PDFDict } = await pdfLib();
  const index = new Map<unknown, number>();
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.Annots();
    if (!annots) continue;
    for (let j = 0; j < annots.size(); j++) {
      const dict = pdfDoc.context.lookupMaybe(annots.get(j), PDFDict);
      if (dict && !index.has(dict)) index.set(dict, i);
    }
  }
  return index;
}

async function describeField(
  field: PDFField,
  pageIndex: Map<unknown, number>
): Promise<FormFieldInfo> {
  const lib = await pdfLib();

  const pageIndices: number[] = [];
  for (const widget of field.acroField.getWidgets()) {
    const idx = pageIndex.get(widget.dict);
    if (idx !== undefined && !pageIndices.includes(idx)) pageIndices.push(idx);
  }
  pageIndices.sort((a, b) => a - b);

  const base = {
    name: field.getName(),
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
    pageIndices,
  };

  if (field instanceof lib.PDFTextField) {
    return {
      ...base,
      kind: "text",
      value: field.getText() ?? "",
      multiline: field.isMultiline(),
      maxLength: field.getMaxLength(),
    };
  }
  if (field instanceof lib.PDFCheckBox) {
    return { ...base, kind: "checkbox", value: field.isChecked() };
  }
  if (field instanceof lib.PDFRadioGroup) {
    return {
      ...base,
      kind: "radio",
      value: field.getSelected() ?? "",
      options: field.getOptions(),
    };
  }
  if (field instanceof lib.PDFDropdown) {
    return {
      ...base,
      kind: "dropdown",
      value: field.getSelected(),
      options: field.getOptions(),
      multiSelect: field.isMultiselect(),
      editable: field.isEditable(),
    };
  }
  if (field instanceof lib.PDFOptionList) {
    return {
      ...base,
      kind: "optionlist",
      value: field.getSelected(),
      options: field.getOptions(),
      multiSelect: field.isMultiselect(),
    };
  }
  if (field instanceof lib.PDFSignature) {
    return { ...base, kind: "signature", value: null };
  }
  return { ...base, kind: "button", value: null };
}

/**
 * Every fillable field in the file, in document order.
 *
 * Returns `[]` for a PDF with no form at all — that is the ordinary case, not
 * an error, and the editor simply hides its form panel.
 *
 * @throws {PdfEncryptedError} password-protected upload.
 * @throws {PdfXfaFormError}   XFA form (see the header).
 */
export async function listFormFields(
  input: ByteSource
): Promise<FormFieldInfo[]> {
  const pdfDoc = await openPdfDocument(input);
  await assertNotXfa(pdfDoc);

  const form = pdfDoc.getForm();
  const pageIndex = await buildWidgetPageIndex(pdfDoc);

  const out: FormFieldInfo[] = [];
  for (const field of form.getFields()) {
    out.push(await describeField(field, pageIndex));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Writing values
 * ------------------------------------------------------------------ */

export type FillFormOptions = {
  /**
   * Bake the values into the page content and remove the fields, so every
   * reader and printer shows exactly the same thing. The values can no longer
   * be edited afterwards — which is normally what the admin wants from a
   * finished form.
   */
  flatten?: boolean;
  /**
   * `true` (the default): a value naming a field the form does not have is a
   * bug, and throws. `applyEdits` passes `false`, because after merging a
   * second PDF a value legitimately belongs to only one of the sources.
   */
  strict?: boolean;
};

function asString(value: FormValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "";
  return value.join(", ");
}

function asStringArray(value: FormValue): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "boolean") return value ? ["true"] : [];
  return value === "" ? [] : [value];
}

function isTruthy(value: FormValue): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return value !== "" && value !== "Off" && value !== "false";
}

async function writeOneField(field: PDFField, value: FormValue): Promise<void> {
  const lib = await pdfLib();

  if (field.isReadOnly()) return;

  if (field instanceof lib.PDFTextField) {
    const text = asString(value);
    field.setText(text === "" ? undefined : text);
    return;
  }
  if (field instanceof lib.PDFCheckBox) {
    if (isTruthy(value)) field.check();
    else field.uncheck();
    return;
  }
  if (field instanceof lib.PDFRadioGroup) {
    const choice = asString(value);
    if (choice === "" || !field.getOptions().includes(choice)) field.clear();
    else field.select(choice);
    return;
  }
  if (field instanceof lib.PDFDropdown) {
    const chosen = asStringArray(value);
    field.clear();
    if (chosen.length === 0) return;
    // A non-editable dropdown rejects anything outside its option list, so
    // filter first rather than letting pdf-lib throw mid-save.
    const allowed = field.isEditable()
      ? chosen
      : chosen.filter((c) => field.getOptions().includes(c));
    if (allowed.length === 0) return;
    field.select(field.isMultiselect() ? allowed : allowed[0]);
    return;
  }
  if (field instanceof lib.PDFOptionList) {
    const chosen = asStringArray(value).filter((c) =>
      field.getOptions().includes(c)
    );
    field.clear();
    if (chosen.length === 0) return;
    field.select(field.isMultiselect() ? chosen : chosen[0]);
    return;
  }
  // Push buttons and signature fields hold nothing we can fill.
}

/**
 * THE ONLY PLACE THE THAI APPEARANCE SEQUENCE IS PERFORMED.
 *
 * `form.updateFieldAppearances(thaiFont)` regenerates the appearance streams
 * of every field that is dirty or has none, using Sarabun instead of the
 * WinAnsi default. Callers MUST then save with `updateFieldAppearances: false`
 * — otherwise pdf-lib runs the whole thing again with Helvetica and throws on
 * the first Thai character. `flatten` must likewise be told not to redo it.
 *
 * The font is fetched only when at least one field actually needs an
 * appearance, so a document with no form never touches the network.
 */
async function writeAppearances(
  pdfDoc: PDFDocument,
  form: PDFForm,
  flatten: boolean
): Promise<void> {
  const needsFont = form.getFields().some((f) => f.needsAppearancesUpdate());

  let thaiFont: PDFFont | undefined;
  if (needsFont) thaiFont = await loadThaiFont(pdfDoc, "regular");

  form.updateFieldAppearances(thaiFont);

  // `flatten()` defaults to updateFieldAppearances: true — i.e. Helvetica,
  // i.e. the crash we just avoided. It must be told we already did it.
  if (flatten) {
    form.flatten({ updateFieldAppearances: false });
    await pruneDanglingAnnots(pdfDoc);
  }
}

/**
 * Clean up after a pdf-lib 1.17.1 bug.
 *
 * `PDFForm.removeField` deletes the widget's *appearance stream* reference
 * from the page's /Annots instead of the widget's own reference, so after
 * `flatten()` every page is left holding references to objects that were
 * deleted from the document. They survive save and reload, resolving to
 * nothing. Readers mostly shrug, but a flattened file should not ship with
 * dangling pointers in it — and a validator will call the file corrupt.
 *
 * Verified against pdf-lib 1.17.1; harmless if a future version fixes it.
 */
async function pruneDanglingAnnots(pdfDoc: PDFDocument): Promise<void> {
  const { PDFName, PDFDict } = await pdfLib();
  const ANNOTS = PDFName.of("Annots");

  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;

    const kept = [];
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      if (pdfDoc.context.lookupMaybe(ref, PDFDict)) kept.push(ref);
    }
    if (kept.length === annots.size()) continue;

    if (kept.length === 0) page.node.delete(ANNOTS);
    else page.node.set(ANNOTS, pdfDoc.context.obj(kept));
  }
}

/**
 * Apply `values` to an already-open document's form and regenerate its
 * appearances. Exported for `applyEdits`, which fills a SOURCE document before
 * its pages are copied into the output. Does not save.
 *
 * @returns the names that were actually written.
 */
export async function applyFormValuesToDoc(
  pdfDoc: PDFDocument,
  values: Record<string, FormValue>,
  options: FillFormOptions = {}
): Promise<string[]> {
  const { flatten = false, strict = true } = options;

  await assertNotXfa(pdfDoc);
  const form = pdfDoc.getForm();

  const applied: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) {
      if (strict) throw new PdfFormFieldNotFoundError(name);
      continue;
    }
    await writeOneField(field, value);
    applied.push(name);
  }

  // Runs even when nothing was written: a form whose fields have no appearance
  // stream at all renders blank until they are generated.
  await writeAppearances(pdfDoc, form, flatten);

  return applied;
}

/**
 * Fill a PDF's form fields and return the new bytes.
 *
 * @throws {PdfEncryptedError}           password-protected upload.
 * @throws {PdfXfaFormError}             XFA form.
 * @throws {PdfFormFieldNotFoundError}   unknown field name (unless
 *                                       `strict: false`).
 * @throws {ThaiFontLoadError}           the Sarabun bytes could not be loaded.
 *                                       There is deliberately no fallback —
 *                                       see pdfFonts.ts.
 */
export async function fillFormFields(
  input: ByteSource,
  values: Record<string, FormValue>,
  options: FillFormOptions = {}
): Promise<Uint8Array> {
  const pdfDoc = await openPdfDocument(input);
  await applyFormValuesToDoc(pdfDoc, values, options);
  // The second half of the sequence. Never let pdf-lib redo appearances here.
  return pdfDoc.save({ updateFieldAppearances: false });
}
