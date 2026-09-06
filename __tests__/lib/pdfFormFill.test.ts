// Real pdf-lib, real Sarabun bytes, real fixtures built with pdf-lib inside
// each test and then reloaded from the SAVED BYTES. Nothing about pdf-lib is
// mocked — only `fetch`, because the module downloads the font same-origin and
// there is no server here.
//
// Every assertion is about the output document, not about which methods were
// called.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { inflateSync } from "zlib";
import path from "path";
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRawStream,
  type PDFStream,
} from "pdf-lib";
import {
  listFormFields,
  fillFormFields,
  openPdfDocument,
  hasXfaEntry,
  PdfEncryptedError,
  PdfXfaFormError,
  PdfOpenError,
  PdfFormFieldNotFoundError,
} from "@/app/lib/pdfFormFill";
import { clearThaiFontByteCache } from "@/app/lib/pdfFonts";

const PUBLIC_DIR = path.resolve(__dirname, "../../public");

/**
 * A Node `Buffer` is a foreign-realm view under jsdom and pdf-lib rejects it
 * with "was actually of type NaN" — the trap pdfBytes.toBytes exists to close.
 */
function readAsBytes(relative: string): Uint8Array {
  const buf = readFileSync(path.join(PUBLIC_DIR, relative));
  return new Uint8Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

beforeEach(() => {
  clearThaiFontByteCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const bytes = readAsBytes(String(input));
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer as ArrayBuffer,
      } as unknown as Response;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearThaiFontByteCache();
});

const THAI = "ที่ห้องเก็บเครื่องมือวัด";

/* ------------------------------------------------------------------ *
 * Fixtures, built with pdf-lib and handed on as SAVED BYTES
 * ------------------------------------------------------------------ */

async function makeFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([400, 500]);
  const page2 = doc.addPage([400, 500]);
  const form = doc.getForm();

  const name = form.createTextField("customer.name");
  name.setText("Acme");
  name.setMaxLength(40);
  name.addToPage(page1, { x: 20, y: 440, width: 240, height: 22 });

  const notes = form.createTextField("customer.notes");
  notes.enableMultiline();
  notes.addToPage(page1, { x: 20, y: 340, width: 240, height: 80 });

  const agree = form.createCheckBox("agree");
  agree.addToPage(page1, { x: 20, y: 300, width: 16, height: 16 });

  const ship = form.createRadioGroup("shipping");
  ship.addOptionToPage("air", page1, { x: 20, y: 260, width: 16, height: 16 });
  ship.addOptionToPage("sea", page1, { x: 60, y: 260, width: 16, height: 16 });
  ship.select("air");

  const branch = form.createDropdown("branch");
  // addToPage generates an appearance immediately, with Helvetica — so the
  // Thai options go on AFTER it, and the Sarabun pass at the end of this
  // fixture draws them. (That ordering trap is exactly what pdfFormFill
  // exists to hide from the rest of the app.)
  branch.addToPage(page2, { x: 20, y: 440, width: 160, height: 22 });
  branch.setOptions(["กรุงเทพ", "เชียงใหม่", "ภูเก็ต"]);
  branch.select("กรุงเทพ");

  const tags = form.createOptionList("tags");
  tags.setOptions(["urgent", "calibration", "repair"]);
  tags.enableMultiselect();
  tags.select("urgent");
  tags.addToPage(page2, { x: 20, y: 340, width: 160, height: 60 });

  const locked = form.createTextField("locked");
  locked.setText("do not touch");
  locked.enableReadOnly();
  locked.addToPage(page2, { x: 20, y: 300, width: 160, height: 22 });

  const sig = form.createTextField("signature.here");
  sig.addToPage(page2, { x: 20, y: 240, width: 160, height: 40 });

  // A Thai dropdown option means pdf-lib's own appearance pass would already
  // be in WinAnsi trouble, so generate the appearances with Sarabun up front.
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  doc.registerFontkit(fontkit);
  const sarabun = await doc.embedFont(readAsBytes("fonts/Sarabun_400Regular.ttf"), {
    subset: true,
  });
  form.updateFieldAppearances(sarabun);

  return new Uint8Array(await doc.save({ updateFieldAppearances: false }));
}

async function makePlainPdf(pages = 1, useObjectStreams = true): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return new Uint8Array(await doc.save({ useObjectStreams }));
}

/** A Latin-only form, so the naive pdf-lib paths can be exercised safely. */
async function makeLatinFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const form = doc.getForm();
  const f = form.createTextField("note");
  f.setText("");
  f.addToPage(page, { x: 20, y: 120, width: 240, height: 22 });
  return new Uint8Array(await doc.save());
}

/**
 * The content-stream operators a reader actually paints for a field.
 * pdf-lib flate-encodes appearance streams, so a reloaded one has to be
 * inflated before it means anything.
 */
function appearanceBytes(doc: PDFDocument, fieldName: string): Uint8Array | null {
  const widget = doc.getForm().getField(fieldName).acroField.getWidgets()[0];
  const normal = widget.getAppearances()?.normal as PDFStream | undefined;
  if (!normal) return null;
  const raw =
    normal instanceof PDFRawStream
      ? normal.getContents()
      : new TextEncoder().encode(normal.getContentsString());
  const filter = String(normal.dict.get(PDFName.of("Filter")) ?? "");
  if (!filter.includes("FlateDecode")) return raw;
  try {
    return new Uint8Array(inflateSync(Buffer.from(raw)));
  } catch {
    return raw;
  }
}

/* ------------------------------------------------------------------ *
 * listFormFields
 * ------------------------------------------------------------------ */

describe("listFormFields", () => {
  it("describes every kind of field, with its current value", async () => {
    const fields = await listFormFields(await makeFormPdf());
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

    expect(fields.map((f) => f.name).sort()).toEqual(
      [
        "agree",
        "branch",
        "customer.name",
        "customer.notes",
        "locked",
        "shipping",
        "signature.here",
        "tags",
      ].sort()
    );

    expect(byName["customer.name"]).toMatchObject({
      kind: "text",
      value: "Acme",
      maxLength: 40,
      multiline: false,
      readOnly: false,
    });
    expect(byName["customer.notes"]).toMatchObject({
      kind: "text",
      value: "",
      multiline: true,
    });
    expect(byName["agree"]).toMatchObject({ kind: "checkbox", value: false });
    expect(byName["shipping"]).toMatchObject({
      kind: "radio",
      value: "air",
      options: ["air", "sea"],
    });
    expect(byName["branch"]).toMatchObject({
      kind: "dropdown",
      value: ["กรุงเทพ"],
      options: ["กรุงเทพ", "เชียงใหม่", "ภูเก็ต"],
    });
    expect(byName["tags"]).toMatchObject({
      kind: "optionlist",
      value: ["urgent"],
      options: ["urgent", "calibration", "repair"],
      multiSelect: true,
    });
    expect(byName["locked"]).toMatchObject({ readOnly: true, value: "do not touch" });
  });

  it("reports which page each field sits on", async () => {
    const fields = await listFormFields(await makeFormPdf());
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

    expect(byName["customer.name"].pageIndices).toEqual([0]);
    expect(byName["agree"].pageIndices).toEqual([0]);
    expect(byName["branch"].pageIndices).toEqual([1]);
    expect(byName["tags"].pageIndices).toEqual([1]);
    // A radio group's two options are both on page 1.
    expect(byName["shipping"].pageIndices).toEqual([0]);
  });

  it("returns [] for a PDF with no form — that is normal, not an error", async () => {
    expect(await listFormFields(await makePlainPdf(2))).toEqual([]);
  });

  it("never touches the network for a form-less PDF", async () => {
    await listFormFields(await makePlainPdf());
    expect(fetch).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

describe("refusals", () => {
  it("refuses an encrypted PDF instead of half-opening it", async () => {
    // pdf-lib 1.17.1 cannot decrypt. `ignoreEncryption: true` would only
    // suppress the throw and hand back ciphertext, so we never pass it.
    // Saved without object streams so there is a classic `trailer` dict to
    // graft an /Encrypt entry onto, which is what pdf-lib checks.
    const plain = await makePlainPdf(1, false);
    const text = Buffer.from(plain).toString("latin1");
    const encrypted = Buffer.from(
      text.replace("trailer\n<<\n", "trailer\n<<\n/Encrypt 3 0 R\n"),
      "latin1"
    );

    const err = await listFormFields(new Uint8Array(encrypted)).catch((e) => e);
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect(err.message).toContain("ตั้งรหัสผ่าน");
    expect(err.message).toContain("ปลดรหัสผ่าน");
  });

  it("refuses an XFA form — pdf-lib lists fields it cannot meaningfully write", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const form = doc.getForm();
    const f = form.createTextField("xfa.shell");
    f.addToPage(page, { x: 10, y: 200, width: 100, height: 20 });
    // Attach XFA the way a real Adobe LiveCycle form carries it. This is set
    // AFTER getForm(), which is the only thing that would strip it.
    form.acroForm.dict.set(
      PDFName.of("XFA"),
      doc.context.obj(["preamble", doc.context.obj({})])
    );
    const bytes = new Uint8Array(await doc.save({ updateFieldAppearances: false }));

    await expect(listFormFields(bytes)).rejects.toBeInstanceOf(PdfXfaFormError);
    await expect(fillFormFields(bytes, { "xfa.shell": "x" })).rejects.toBeInstanceOf(
      PdfXfaFormError
    );
    await expect(listFormFields(bytes)).rejects.toThrow(/XFA/);
  });

  it("detects XFA from the raw catalog, because getForm() deletes it", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const form = doc.getForm();
    form.acroForm.dict.set(PDFName.of("XFA"), doc.context.obj([]));

    // The trap, demonstrated: asking pdf-lib the obvious way destroys the
    // evidence and answers "no".
    expect(await hasXfaEntry(doc)).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    doc.getForm();
    warn.mockRestore();
    expect(await hasXfaEntry(doc)).toBe(false);
  });

  it("reports unreadable bytes as a Thai open error", async () => {
    const junk = new TextEncoder().encode("this is definitely not a PDF");
    await expect(listFormFields(junk)).rejects.toBeInstanceOf(PdfOpenError);
    await expect(listFormFields(junk)).rejects.toThrow(/เปิดไฟล์ PDF ไม่สำเร็จ/);
  });

  it("throws on an unknown field name in strict mode, and skips it otherwise", async () => {
    const bytes = await makeFormPdf();

    await expect(
      fillFormFields(bytes, { "no.such.field": "x" })
    ).rejects.toBeInstanceOf(PdfFormFieldNotFoundError);

    const out = await fillFormFields(
      bytes,
      { "no.such.field": "x", "customer.name": "ok" },
      { strict: false }
    );
    const re = await PDFDocument.load(out);
    expect(re.getForm().getTextField("customer.name").getText()).toBe("ok");
  });
});

/* ------------------------------------------------------------------ *
 * THE THAI APPEARANCE SEQUENCE — the three outcomes, all demonstrated
 * ------------------------------------------------------------------ */

describe("the Thai appearance sequence", () => {
  it("OUTCOME 1: pdf-lib's default save CRASHES on a Thai value", async () => {
    const doc = await PDFDocument.load(await makeLatinFormPdf());
    doc.getForm().getTextField("note").setText(THAI);
    // updateFieldAppearances defaults to true, with Helvetica.
    await expect(doc.save()).rejects.toThrow(/WinAnsi cannot encode/);
  });

  it("OUTCOME 2: updateFieldAppearances:false ALONE leaves the field blank", async () => {
    const original = await makeLatinFormPdf();
    const before = appearanceBytes(await PDFDocument.load(original), "note");

    const doc = await PDFDocument.load(original);
    doc.getForm().getTextField("note").setText(THAI);
    const saved = await doc.save({ updateFieldAppearances: false });

    const re = await PDFDocument.load(saved);
    // The VALUE is in the file...
    expect(re.getForm().getTextField("note").getText()).toBe(THAI);
    // ...but what a reader paints never changed. The field shows nothing.
    const after = appearanceBytes(re, "note");
    expect(after).toEqual(before);
  });

  it("OUTCOME 3: fillFormFields writes the value AND a matching appearance", async () => {
    const original = await makeLatinFormPdf();
    const before = appearanceBytes(await PDFDocument.load(original), "note");

    const saved = await fillFormFields(original, { note: THAI });

    const re = await PDFDocument.load(saved);
    expect(re.getForm().getTextField("note").getText()).toBe(THAI);

    const after = appearanceBytes(re, "note");
    expect(after).not.toEqual(before);
    expect(after!.byteLength).toBeGreaterThan((before?.byteLength ?? 0) + 10);

    // The appearance really draws text, with a real embedded font behind it.
    const ops = Buffer.from(after!).toString("latin1");
    expect(ops).toMatch(/Tj|TJ/);

    const widget = re.getForm().getField("note").acroField.getWidgets()[0];
    const ap = widget.getAppearances()!.normal as PDFStream;
    const resources = ap.dict.lookup(PDFName.of("Resources"), PDFDict);
    const fonts = resources.lookup(PDFName.of("Font"), PDFDict);
    expect(fonts.keys().length).toBeGreaterThan(0);
    const fontDict = fonts.lookup(fonts.keys()[0], PDFDict);
    expect(String(fontDict.get(PDFName.of("BaseFont")))).toMatch(/Sarabun/i);
  });

  it("fails loudly rather than silently when the font cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 }) as Response));
    await expect(
      fillFormFields(await makeLatinFormPdf(), { note: THAI })
    ).rejects.toThrow(/โหลดฟอนต์ภาษาไทยไม่สำเร็จ/);
  });
});

/* ------------------------------------------------------------------ *
 * fillFormFields
 * ------------------------------------------------------------------ */

describe("fillFormFields", () => {
  it("round-trips every field kind through save and reload", async () => {
    const saved = await fillFormFields(await makeFormPdf(), {
      "customer.name": "บริษัท วิสดอมวาสท์ จำกัด",
      "customer.notes": "ส่งของ\nชั้น 3 ห้อง 301",
      agree: true,
      shipping: "sea",
      branch: "เชียงใหม่",
      tags: ["calibration", "repair"],
    });

    const re = await PDFDocument.load(saved);
    const form = re.getForm();
    expect(form.getTextField("customer.name").getText()).toBe(
      "บริษัท วิสดอมวาสท์ จำกัด"
    );
    expect(form.getTextField("customer.notes").getText()).toBe(
      "ส่งของ\nชั้น 3 ห้อง 301"
    );
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    expect(form.getRadioGroup("shipping").getSelected()).toBe("sea");
    expect(form.getDropdown("branch").getSelected()).toEqual(["เชียงใหม่"]);
    expect(form.getOptionList("tags").getSelected()).toEqual([
      "calibration",
      "repair",
    ]);
  });

  it("leaves fields absent from `values` exactly as they were", async () => {
    const saved = await fillFormFields(await makeFormPdf(), { agree: true });
    const form = (await PDFDocument.load(saved)).getForm();
    expect(form.getTextField("customer.name").getText()).toBe("Acme");
    expect(form.getRadioGroup("shipping").getSelected()).toBe("air");
  });

  it("refuses to modify a read-only field", async () => {
    const saved = await fillFormFields(await makeFormPdf(), {
      locked: "overwritten",
    });
    const form = (await PDFDocument.load(saved)).getForm();
    expect(form.getTextField("locked").getText()).toBe("do not touch");
  });

  it("clears a text field when given an empty string", async () => {
    const saved = await fillFormFields(await makeFormPdf(), {
      "customer.name": "",
    });
    const form = (await PDFDocument.load(saved)).getForm();
    expect(form.getTextField("customer.name").getText()).toBeUndefined();
  });

  it("unchecks a checkbox for false", async () => {
    const checked = await fillFormFields(await makeFormPdf(), { agree: true });
    const cleared = await fillFormFields(checked, { agree: false });
    expect(
      (await PDFDocument.load(cleared)).getForm().getCheckBox("agree").isChecked()
    ).toBe(false);
  });

  it("clears a radio group for an empty or unknown choice", async () => {
    const saved = await fillFormFields(await makeFormPdf(), { shipping: "" });
    expect(
      (await PDFDocument.load(saved)).getForm().getRadioGroup("shipping").getSelected()
    ).toBeUndefined();

    const bogus = await fillFormFields(await makeFormPdf(), { shipping: "rocket" });
    expect(
      (await PDFDocument.load(bogus)).getForm().getRadioGroup("shipping").getSelected()
    ).toBeUndefined();
  });

  it("ignores a dropdown choice that is not one of the options", async () => {
    // pdf-lib would otherwise throw from inside select(); dropping the bad
    // value keeps the download working and leaves the field untouched.
    const saved = await fillFormFields(await makeFormPdf(), { branch: "ขอนแก่น" });
    const form = (await PDFDocument.load(saved)).getForm();
    expect(form.getDropdown("branch").getSelected()).toEqual([]);
  });

  it("accepts a bare string for a multi-select list", async () => {
    const saved = await fillFormFields(await makeFormPdf(), { tags: "repair" });
    expect(
      (await PDFDocument.load(saved)).getForm().getOptionList("tags").getSelected()
    ).toEqual(["repair"]);
  });

  it("returns bytes that reload as a valid PDF with the same page count", async () => {
    const saved = await fillFormFields(await makeFormPdf(), { agree: true });
    expect(saved).toBeInstanceOf(Uint8Array);
    const re = await PDFDocument.load(saved);
    expect(re.getPageCount()).toBe(2);
  });

  it("is idempotent — filling the output again gives the same values", async () => {
    const once = await fillFormFields(await makeFormPdf(), {
      "customer.name": THAI,
    });
    const twice = await fillFormFields(once, { "customer.name": THAI });
    expect(
      (await PDFDocument.load(twice)).getForm().getTextField("customer.name").getText()
    ).toBe(THAI);
  });

  it("does not detach or mutate the caller's bytes", async () => {
    const input = await makeFormPdf();
    const copy = input.slice();
    await fillFormFields(input, { agree: true });
    expect(input.byteLength).toBe(copy.byteLength);
    expect(input).toEqual(copy);
  });
});

/* ------------------------------------------------------------------ *
 * Flattening
 * ------------------------------------------------------------------ */

describe("fillFormFields({ flatten: true })", () => {
  it("removes the fields and bakes the values into the pages", async () => {
    const saved = await fillFormFields(
      await makeFormPdf(),
      { "customer.name": THAI, agree: true },
      { flatten: true }
    );

    const re = await PDFDocument.load(saved);
    expect(re.getForm().getFields()).toEqual([]);
    expect(re.getPageCount()).toBe(2);
  });

  it("leaves no dangling annotation references behind", async () => {
    // pdf-lib 1.17.1's removeField deletes the wrong ref from /Annots, so a
    // flattened page is left pointing at objects that no longer exist.
    const saved = await fillFormFields(
      await makeFormPdf(),
      { "customer.name": THAI },
      { flatten: true }
    );
    const re = await PDFDocument.load(saved);

    for (const page of re.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        expect(
          re.context.lookupMaybe(annots.get(i), PDFDict),
          `page annots still reference a deleted object: ${String(annots.get(i))}`
        ).toBeDefined();
      }
    }
  });

  it("flattens Thai without a WinAnsi crash", async () => {
    // flatten() defaults to updateFieldAppearances: true — Helvetica, and a
    // crash. The module must have already generated Sarabun appearances and
    // told flatten not to redo them.
    await expect(
      fillFormFields(
        await makeFormPdf(),
        { "customer.name": THAI, "customer.notes": THAI },
        { flatten: true }
      )
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it("keeps the fields interactive when flatten is false", async () => {
    const saved = await fillFormFields(
      await makeFormPdf(),
      { "customer.name": THAI },
      { flatten: false }
    );
    const re = await PDFDocument.load(saved);
    expect(re.getForm().getFields().length).toBeGreaterThan(0);
    expect(re.getForm().getTextField("customer.name").getText()).toBe(THAI);
  });

  it("a flattened page's content stream grew by the drawn widgets", async () => {
    const bytes = await makeFormPdf();
    const plain = await fillFormFields(bytes, { "customer.name": THAI });
    const flat = await fillFormFields(
      bytes,
      { "customer.name": THAI },
      { flatten: true }
    );

    const contentSize = async (b: Uint8Array) => {
      const doc = await PDFDocument.load(b);
      const contents = doc.getPage(0).node.Contents();
      return contents ? contents.sizeInBytes() : 0;
    };
    expect(await contentSize(flat)).toBeGreaterThan(await contentSize(plain));
  });
});

/* ------------------------------------------------------------------ *
 * openPdfDocument
 * ------------------------------------------------------------------ */

describe("openPdfDocument", () => {
  it("accepts an ArrayBuffer as well as a Uint8Array", async () => {
    const bytes = await makePlainPdf(3);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const doc = await openPdfDocument(ab);
    expect(doc.getPageCount()).toBe(3);
  });
});
