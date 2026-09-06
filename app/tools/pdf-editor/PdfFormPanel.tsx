"use client";

import SearchableDropdown from "../../components/SearchableDropdown";
import MultiSelectDropdown from "../../components/MultiSelectDropdown";
import type { FormValue } from "../../lib/pdfTypes";
import type { FormFieldInfo } from "../../lib/pdfFormFill";

/**
 * Fills in the AcroForm fields a PDF already has.
 *
 * THIS PANEL IS GATED ON THERE ACTUALLY BEING FIELDS, and — just as important —
 * it SAYS SO IN THAI when there are none. Most PDFs an admin here will open are
 * not forms at all: a scanned purchase order is one big image per page and has
 * no fields to fill, and silently showing an empty panel reads as "the tool is
 * broken" rather than "this file has no form". The two dead ends get their own
 * plain-language explanation and a pointer at the tools that DO work on such a
 * file (ทับขาว + ข้อความ):
 *
 *   • NO FIELDS  — a scanned or flattened document.
 *   • XFA        — Adobe LiveCycle's XML form layer. pdf-lib cannot fill it and
 *                  never will; the AcroForm dictionary such a file carries is a
 *                  decoy that renders blank in most viewers. Refusing plainly
 *                  beats writing values nobody will ever see.
 *
 * Every dropdown here is SearchableDropdown / MultiSelectDropdown, never a
 * native <select> (AGENTS.md), and the read-only / no-document state is a
 * `<fieldset disabled>` wrapper because SearchableDropdown takes no `disabled`.
 */

export interface PdfFormPanelProps {
  /** True once a PDF is open. False renders nothing — the page shows the drop zone. */
  hasDocument: boolean;
  /** The file's XFA verdict, from `hasXfaEntry` / the `PdfXfaFormError` thrown
   *  by `listFormFields`. Asked BEFORE `getForm()`, which deletes the entry. */
  isXfa: boolean;
  fields: FormFieldInfo[];
  values: Record<string, FormValue>;
  onChange: (fieldName: string, value: FormValue) => void;
  flattenForm: boolean;
  onFlattenFormChange: (flatten: boolean) => void;
  /** An export is running — freeze the inputs rather than let a value change
   *  underneath the bytes being written. */
  disabled?: boolean;
}

/** `FormFieldInfo.options` is a bare string list; the shared dropdowns want
 *  `{ value, label }` pairs. The option IS its own label in a PDF form. */
function toOptions(options: string[] | undefined) {
  return (options ?? []).map((option) => ({ value: option, label: option }));
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-3"
      aria-label="ฟอร์มในเอกสาร"
    >
      <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
        <span aria-hidden="true">🧾</span> ฟอร์มในเอกสาร
      </h2>
      {children}
    </section>
  );
}

/** The shared "there is nothing to fill in here, and here is what to do
 *  instead" block. Both dead ends end at the same advice on purpose. */
function NoFormNotice({ heading, explanation }: { heading: string; explanation: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-3 text-sm leading-relaxed text-amber-900 space-y-2">
      <p className="font-bold">{heading}</p>
      <p>{explanation}</p>
      <p className="text-xs text-amber-800">
        ยังแก้ไฟล์นี้ได้ตามปกติ — ใช้เครื่องมือ <strong>“ทับขาว”</strong> ปิดทับข้อความเดิม แล้วใช้{" "}
        <strong>“ข้อความ”</strong> พิมพ์ทับลงไปแทนการกรอกฟอร์ม
      </p>
    </div>
  );
}

export default function PdfFormPanel({
  hasDocument,
  isXfa,
  fields,
  values,
  onChange,
  flattenForm,
  onFlattenFormChange,
  disabled = false,
}: PdfFormPanelProps) {
  if (!hasDocument) return null;

  if (isXfa) {
    return (
      <PanelShell>
        <NoFormNotice
          heading="ไฟล์นี้เป็นฟอร์มแบบ XFA — กรอกผ่านเครื่องมือนี้ไม่ได้"
          explanation={
            <>
              ฟอร์ม XFA เป็นฟอร์มแบบพิเศษของ Adobe ที่เก็บช่องกรอกไว้คนละชั้นกับตัวหน้ากระดาษ
              เครื่องมือนี้เขียนค่าลงไปไม่ได้ ถ้าจำเป็นต้องกรอกจริง ๆ ให้เปิดไฟล์ด้วย Adobe Acrobat
              กรอกแล้วสั่ง “บันทึกเป็นสำเนา” (Save as Copy) เพื่อให้ได้ PDF ธรรมดา
              แล้วค่อยนำไฟล์นั้นกลับมาแก้ต่อที่นี่
            </>
          }
        />
      </PanelShell>
    );
  }

  if (fields.length === 0) {
    return (
      <PanelShell>
        <NoFormNotice
          heading="ไฟล์นี้ไม่มีช่องฟอร์มให้กรอก"
          explanation={
            <>
              ในไฟล์นี้ไม่มีช่องกรอก (AcroForm) อยู่เลย — เอกสารที่ได้มาจากการ{" "}
              <strong>สแกน</strong> หรือที่ถูกสั่ง “ตรึงข้อมูล” (flatten) ไว้แล้ว
              จะเป็นแค่ภาพกับข้อความที่ตรึงตำแหน่งไว้ ไม่มีช่องให้พิมพ์
            </>
          }
        />
      </PanelShell>
    );
  }

  const editableCount = fields.filter((field) => !field.readOnly).length;

  return (
    <PanelShell>
      <p className="text-xs text-gray-500 leading-relaxed">
        พบช่องกรอกในไฟล์นี้ <strong className="text-gray-900">{fields.length}</strong> ช่อง
        {editableCount !== fields.length && (
          <>
            {" "}
            (กรอกได้จริง <strong className="text-gray-900">{editableCount}</strong> ช่อง
            ที่เหลือถูกล็อกไว้ในไฟล์ต้นฉบับ)
          </>
        )}
      </p>

      <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
        {fields.map((field) => {
          // A PDF field has no separate human label — the fully qualified name
          // IS what the form's author called it, and it is also the key in
          // `EditModel.formValues`, so showing it keeps the panel and the saved
          // model talking about the same thing.
          const label = field.name;
          const inputId = `pdf-form-field-${field.name}`;
          // Fall back to the value already in the file, so an existing entry is
          // shown rather than silently blanked the moment the panel opens.
          const raw = field.name in values ? values[field.name] : field.value;
          const multiSelect =
            field.kind === "optionlist" || (field.kind === "dropdown" && field.multiSelect === true);

          if (field.kind === "button" || field.kind === "signature") {
            // Not fillable as data. Listed anyway so the count above matches
            // what the admin can see, rather than looking like a miscount.
            return (
              <div key={field.name} className="text-xs text-gray-400">
                <span className="font-semibold text-gray-500">{label}</span> — ช่องประเภทนี้กรอกไม่ได้
              </div>
            );
          }

          return (
            <div key={field.name}>
              <label
                htmlFor={inputId}
                className="block text-xs font-bold text-gray-500 mb-1 wrap-break-word"
              >
                {label}
                {field.required && <span className="text-red-500"> *</span>}
                {field.readOnly && <span className="text-gray-400 font-normal"> (ล็อกไว้)</span>}
              </label>

              {field.kind === "checkbox" ? (
                <button
                  id={inputId}
                  type="button"
                  role="switch"
                  aria-checked={raw === true}
                  disabled={field.readOnly}
                  onClick={() => onChange(field.name, raw !== true)}
                  className={`px-4 py-2 rounded-xl border font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    raw === true
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {raw === true ? "✓ ติ๊กแล้ว" : "ยังไม่ติ๊ก"}
                </button>
              ) : multiSelect ? (
                <fieldset disabled={field.readOnly} className="disabled:opacity-50">
                  <MultiSelectDropdown
                    options={toOptions(field.options)}
                    values={Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : []}
                    onChange={(next) => onChange(field.name, next)}
                    placeholder="เลือกได้มากกว่าหนึ่งข้อ..."
                  />
                </fieldset>
              ) : field.kind === "dropdown" && field.editable ? (
                // A combo box accepts free text as well as its listed options,
                // and a dropdown cannot express that. A plain text box can —
                // with the options shown underneath so they are still usable.
                <>
                  <input
                    id={inputId}
                    type="text"
                    readOnly={field.readOnly}
                    value={typeof raw === "string" ? raw : ""}
                    onChange={(event) => onChange(field.name, event.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 read-only:bg-gray-50 read-only:text-gray-400"
                  />
                  {(field.options?.length ?? 0) > 0 && (
                    <p className="text-xs text-gray-400 mt-1 wrap-break-word">
                      พิมพ์เองได้ หรือใช้ตัวเลือกเดิม: {field.options!.join(" · ")}
                    </p>
                  )}
                </>
              ) : field.kind === "radio" || field.kind === "dropdown" ? (
                <fieldset disabled={field.readOnly} className="disabled:opacity-50">
                  <SearchableDropdown
                    options={toOptions(field.options)}
                    value={typeof raw === "string" ? raw : ""}
                    onChange={(next) => onChange(field.name, next)}
                    searchable={false}
                    placeholder="เลือก..."
                  />
                </fieldset>
              ) : field.multiline ? (
                <textarea
                  id={inputId}
                  rows={3}
                  maxLength={field.maxLength ?? undefined}
                  readOnly={field.readOnly}
                  value={typeof raw === "string" ? raw : ""}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 read-only:bg-gray-50 read-only:text-gray-400"
                />
              ) : (
                <input
                  id={inputId}
                  type="text"
                  maxLength={field.maxLength ?? undefined}
                  readOnly={field.readOnly}
                  value={typeof raw === "string" ? raw : ""}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 read-only:bg-gray-50 read-only:text-gray-400"
                />
              )}
            </div>
          );
        })}
      </fieldset>

      <div className="border-t border-gray-100 pt-3">
        <button
          type="button"
          role="switch"
          aria-checked={flattenForm}
          disabled={disabled}
          onClick={() => onFlattenFormChange(!flattenForm)}
          className={`w-full px-3 py-2 rounded-xl border font-semibold text-sm transition-all text-left disabled:opacity-40 ${
            flattenForm
              ? "bg-violet-50 border-violet-300 text-violet-700"
              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {flattenForm ? "☑" : "☐"} ตรึงค่าที่กรอกให้ติดไปกับหน้ากระดาษ
        </button>
        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
          เปิดไว้ = ไฟล์ที่ได้จะไม่มีช่องกรอกเหลืออยู่ ใครเปิดต่อก็แก้ค่าไม่ได้อีก
          (เหมาะกับเอกสารที่จะส่งให้ลูกค้า) ปิดไว้ = ยังเป็นฟอร์มที่แก้ค่าได้อยู่
        </p>
      </div>
    </PanelShell>
  );
}
