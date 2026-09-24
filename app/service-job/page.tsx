"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import SearchableDropdown from "../components/SearchableDropdown";
import DatePicker from "../components/DatePicker";
import { useLeaveGuard, LeaveGuardModal } from "../components/LeaveGuard";
import { toLocalDateString, formatDisplayDate, isValidDateString } from "../lib/dateFormat";
import { stripHtml } from "../lib/stripHtml";
import type { ServiceJob, ServiceJobStatus } from "../lib/types";

// ── ใบ Job — สร้าง/แก้ไขใบบันทึกงานบริการ (the printed job sheet) ─────────────
//
// WHAT THIS PAGE IS FOR. It produces ONE piece of paper. The office fills the
// left-hand form from data the system already holds, downloads the A4 sheet on
// the right as a PDF, and prints it. The technician carries that paper to the
// site, writes what he did on it BY HAND, and the customer signs it with a pen.
// The signed paper comes back and is filed in a folder — nothing is scanned,
// uploaded or signed on a screen.
//
// Three rules the layout exists to serve, and which are easy to "tidy away":
//
//  1. THE SERIAL NUMBER IS NEVER TYPED. It is read off the machine row the
//     admin picked (`customer_equipments.serialNumber`) and there is no input
//     for it anywhere on this page. The serial is what binds a service history
//     to one physical unit; a typo binds that history to the wrong machine and
//     nobody ever finds out. Same reason the machine dropdown is filtered to
//     the chosen customer: one sheet is one visit to one site.
//
//  2. THE "งานที่ทำ" COLUMN IS DELIBERATELY EMPTY, and the description area
//     below it is DELIBERATELY RULED. The owner asked for room to write, not a
//     checklist to tick ("แค่เว้นช่องไว้ให้ช่างไปเขียนเองหน้างาน"). Blank white
//     space makes handwriting drift and scans back badly; the lines are the
//     difference between a form and a sheet of paper.
//
//  3. ISSUING WRITES NO SERVICE HISTORY. Saving here only produces the paper.
//     The visit is recorded when the signed paper comes back and someone presses
//     ปิดงาน on /service-job/saved (see serviceJobStore.completeJob).
//
// The job NUMBER is minted server-side, inside the transaction that writes the
// row (INSERT into the shared `used_docnos` ledger, `ER_DUP_ENTRY` → next free
// number). This page therefore never invents one, and the sheet shows a
// placeholder until the first save comes back — a number two browsers could
// both choose is not a document number.

// Seller identity. The NAME/logo are the same fixed pair the quotation and
// billing sheets print, so all three documents read as coming from one company;
// the ADDRESS and PHONE are the admin-editable ones from the company profile in
// /settings (GET /api/settings/company-profile), with these as the fallback for
// the seconds before that fetch lands or if it fails — a job sheet must print
// with an address either way.
const COMPANY = {
  name: "บริษัท โปรฟิน แล็บสเกล จำกัด",
  nameEn: "PROFIN LAB SCALE CO., LTD.",
  address:
    "93 ซอยงามวงศ์วาน 6 แยก 19 ถนนงามวงศ์วาน ตำบลบางเขน อำเภอเมืองนนทบุรี จ.นนทบุรี 11000",
  phone: "062-012-9895",
};

// How many ruled 8.5mm lines the general description area carries.
//
// IT ADAPTS TO THE MACHINE COUNT, AND THAT IS THE WHOLE POINT. A fixed six
// lines was six lines whether the sheet listed one machine or eight: the
// one-machine sheet — the commonest one — then printed six lines and left
// roughly a THIRD OF THE A4 PAGE blank below the signatures, i.e. paper the
// technician is carrying and cannot write on, which is precisely the failure
// this document exists to avoid ("แค่เว้นช่องไว้ให้ช่างไปเขียนเองหน้างาน").
//
// So the note area takes back what the machine table does not use: a machine
// row costs about 20mm of page, a ruled line 8.5mm, hence ~2 lines returned per
// machine dropped. Bounded at both ends — never fewer than 3 (a note area
// smaller than that is decoration), never more than 12 (a nearly empty sheet
// must not print a page of stripes, and the signature block has to stay on the
// same page as the table).
//
// generatePdf() MEASURES the live block rather than assuming a height, so the
// page-break rule follows this automatically; do not hardcode a height there.
const MIN_DESCRIPTION_LINES = 3;
const MAX_DESCRIPTION_LINES = 12;
function descriptionLines(machineCount: number): number {
  const forMachines = MAX_DESCRIPTION_LINES - 2 * Math.max(0, machineCount - 1);
  return Math.min(
    MAX_DESCRIPTION_LINES,
    Math.max(MIN_DESCRIPTION_LINES, forMachines)
  );
}

interface CompanyRow {
  id: string;
  name: string;
}

interface CustomerRow {
  id: string;
  companyId: string;
  name: string;
  phone?: string;
  companyName?: string;
}

interface EquipmentRow {
  id: string;
  customerId: string;
  serialNumber?: string | null;
  productName?: string | null;
}

/** One machine line on the sheet. `serialNumber` is carried for PRINTING only
 * and always comes from the picked equipment row — it is never editable. */
interface PickedEquipment {
  equipmentId: string;
  productName: string;
  serialNumber: string;
}

const STATUS_LABELS: Record<ServiceJobStatus, string> = {
  issued: "ออกใบแล้ว (ยังไม่ปิดงาน)",
  completed: "ปิดงานแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

/** A blank ruled line to write on with a pen — NOT an empty gap. Used wherever
 * an optional value was left blank on purpose (the technician's name above all:
 * "ถ้าไม่พิมก็เว้นไว้ให้ช่างไปเขียนเอง"). */
function RuledBlank({ width = "48mm" }: { width?: string }) {
  return (
    <span
      className="inline-block border-b border-gray-500 align-bottom"
      style={{ width, height: "1.15em" }}
    />
  );
}

export default function ServiceJobPage() {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useAuth();

  // ── The document ──────────────────────────────────────────────────────────
  const [jobId, setJobId] = useState("");
  /** The number the SERVER minted for this sheet. Empty until a save comes
   *  back. Nothing on this page ever writes anything else into it — see the
   *  JOB NO. block in the form. */
  const [jobNo, setJobNo] = useState("");
  /** What the ledger says the next free number for `jobDate` is — a PREVIEW,
   *  shown so the admin knows what he is about to print. It reserves nothing
   *  and is never sent back to the server, never printed, and never allowed
   *  to stand in for `jobNo` on the sheet. */
  const [nextJobNoPreview, setNextJobNoPreview] = useState("");
  const [status, setStatus] = useState<ServiceJobStatus>("issued");
  const [companyId, setCompanyId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [jobDate, setJobDate] = useState("");
  const [technicianName, setTechnicianName] = useState("");
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  /** The linked appointment was deleted after this sheet was issued. A NORMAL
   * state (the link is a plain id with no FK, on purpose) — the sheet still
   * opens, prints and closes; the screen just says so instead of breaking. */
  const [scheduleGone, setScheduleGone] = useState(false);
  const [picked, setPicked] = useState<PickedEquipment[]>([]);
  /** Additional contacts shown on the printed sheet (display only, same company). */
  const [additionalContacts, setAdditionalContacts] = useState<string[]>([]);

  // ── Lookups ───────────────────────────────────────────────────────────────
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [equipments, setEquipments] = useState<EquipmentRow[]>([]);
  const [equipmentsLoading, setEquipmentsLoading] = useState(false);
  const [profile, setProfile] = useState({
    address: COMPANY.address,
    phone: COMPANY.phone,
  });

  // ── UI ────────────────────────────────────────────────────────────────────
  const [hydrating, setHydrating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [confirmSwitchParty, setConfirmSwitchParty] = useState<
    { kind: "company"; value: string } | { kind: "customer"; value: string } | null
  >(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The hydrate effect below must run EXACTLY once. Its deps include `adopt`,
  // which is rebuilt on every keystroke (setSnapshot closes over the current
  // form), so without this flag every edit would re-run the whole hydration and
  // throw away what was just typed.
  const hydratedRef = useRef(false);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  // Auth gate — copied verbatim from the other admin pages, INCLUDING the
  // early-return spinner below. Without that return the form paints for a frame
  // before the redirect lands, which on a shared screen means flashing customer
  // names and serial numbers at whoever is not logged in.
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace("/login");
  }, [isLoggedIn, isLoading, router]);

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  // Fingerprints exactly what a save would send, so reordering machines counts
  // as a change (the order is what prints) but a re-fetched display name does
  // not.
  const formData = useMemo(
    () => ({
      companyId,
      customerId,
      jobDate,
      technicianName,
      scheduleId,
      equipmentIds: picked.map((p) => p.equipmentId),
    }),
    [companyId, customerId, jobDate, technicianName, scheduleId, picked]
  );
  const { isDirty, setSnapshot, guardedNavigate, showModal, confirmLeave, cancelLeave } =
    useLeaveGuard(formData);

  const locked = status !== "issued";

  // ── The number the sheet is going to carry ────────────────────────────────
  // For a sheet that has not been saved yet, ask the ledger what the next free
  // number for this date is and SHOW it, so the admin is not choosing a date
  // and pressing print with no idea what number comes out. It is a preview:
  // the server mints the real number on save (another admin may take this one
  // first), so it is never sent back, never written onto the sheet and never
  // put into `jobNo`.
  useEffect(() => {
    if (!isLoggedIn || jobId || !jobDate || !isValidDateString(jobDate)) return;
    let cancelled = false;
    fetch(`/api/service-jobs/next-no?date=${encodeURIComponent(jobDate)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setNextJobNoPreview(typeof data?.jobNo === "string" ? data.jobNo : "");
      })
      .catch(() => {
        if (!cancelled) setNextJobNoPreview("");
      });
    // Clearing belongs in the cleanup, not the body: the date changing, or the
    // sheet being saved, must drop the OLD preview immediately rather than
    // leave yesterday's number under a new date while the next answer lands.
    return () => {
      cancelled = true;
      setNextJobNoPreview("");
    };
  }, [isLoggedIn, jobId, jobDate]);

  // ── Lookups: companies + contacts ─────────────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn) return;
    fetch("/api/companies")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setCompanies(Array.isArray(list) ? list : []))
      .catch(() => { });
    fetch("/api/customers?fields=list")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setCustomers(Array.isArray(list) ? list : []))
      .catch(() => { });
    fetch("/api/settings/company-profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) return;
        setProfile({
          address: p.addressDisplay || COMPANY.address,
          phone: p.phone || COMPANY.phone,
        });
      })
      .catch(() => { });
  }, [isLoggedIn]);

  // ── Lookup: all machines in the system ────────────────────────────────────
  // We now load all equipments so the user can pick any machine in the system,
  // even if it belongs to another customer.
  useEffect(() => {
    if (!isLoggedIn) {
      setEquipments([]);
      return;
    }
    let cancelled = false;
    setEquipmentsLoading(true);
    fetch(`/api/admin/equipments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (cancelled) return;
        setEquipments(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setEquipments([]);
      })
      .finally(() => {
        if (!cancelled) setEquipmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  /** Adopt a saved sheet as "the document open on screen": state AND the clean
   * snapshot, so isDirty only fires on edits made from here on. */
  const adopt = useCallback(
    (job: ServiceJob) => {
      const rows: PickedEquipment[] = (job.equipments || []).map((e) => ({
        equipmentId: e.equipmentId,
        productName: stripHtml(e.productName || ""),
        serialNumber: e.serialNumber || "",
      }));
      setJobId(job.id);
      setJobNo(job.jobNo || "");
      setStatus(job.status);
      setCompanyId(job.companyId || "");
      setCustomerId(job.customerId || "");
      setJobDate(job.jobDate || "");
      setTechnicianName(job.technicianName || "");
      setScheduleId(job.scheduleId || null);
      setScheduleGone(Boolean(job.scheduleId) && job.scheduleExists === false);
      setPicked(rows);
      setSnapshot({
        companyId: job.companyId || "",
        customerId: job.customerId || "",
        jobDate: job.jobDate || "",
        technicianName: job.technicianName || "",
        scheduleId: job.scheduleId || null,
        equipmentIds: rows.map((r) => r.equipmentId),
      });
    },
    [setSnapshot]
  );

  // ── Hydrate ───────────────────────────────────────────────────────────────
  // Runs ONCE on mount and reads the query string directly, exactly as
  // /quotation does: Next.js keeps this client component mounted when only the
  // query string changes, so anything that depends on a param has to be done
  // here or in place — never by expecting this effect to run again.
  //
  //   ?id=<jobId>          reopen a saved sheet
  //   ?scheduleId=<id>     a sheet FOR AN EXISTING APPOINTMENT — customer and
  //                        machine are pulled from that appointment
  //   ?equipmentId=<id>    a sheet for one machine (from the equipment registry)
  useEffect(() => {
    if (!isLoggedIn || hydratedRef.current) return;
    hydratedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const reopenId = params.get("id");
    const fromSchedule = params.get("scheduleId");
    const fromEquipment = params.get("equipmentId");

    if (reopenId) {
      setHydrating(true);
      fetch(`/api/service-jobs/${encodeURIComponent(reopenId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((job) => {
          if (job?.id) adopt(job as ServiceJob);
          else showToast("ไม่พบใบงานบริการนี้ — เริ่มใบใหม่แทน", "error");
        })
        .catch(() => showToast("โหลดใบงานบริการไม่สำเร็จ", "error"))
        .finally(() => setHydrating(false));
      return;
    }

    const today = toLocalDateString(new Date());
    setJobDate(today);

    // NO number is invented here. A job number is a claim on `used_docnos` —
    // the never-purged ledger quotations and billing share — and the server
    // mints it inside the transaction that writes the row. What this page
    // shows before that is the PREVIEW fetched below, clearly labelled as one.

    if (!fromSchedule && !fromEquipment) {
      // A blank new sheet: today's date is the system's suggestion, not the
      // admin's work, so it must not count as an unsaved change — otherwise
      // opening the page and leaving it would raise the leave guard.
      setSnapshot({
        companyId: "",
        customerId: "",
        jobDate: today,
        technicianName: "",
        scheduleId: null,
        equipmentIds: [],
      });
      return;
    }

    setHydrating(true);
    (async () => {
      try {
        let equipmentId = fromEquipment || "";
        if (fromSchedule) {
          const res = await fetch(`/api/admin/schedules/${encodeURIComponent(fromSchedule)}`);
          if (!res.ok) throw new Error("schedule");
          const schedule = await res.json();
          equipmentId = String(schedule?.equipmentId || "");
          setScheduleId(fromSchedule);
          if (schedule?.scheduledDate && isValidDateString(String(schedule.scheduledDate))) {
            setJobDate(String(schedule.scheduledDate));
          }
          if (!equipmentId) {
            // A customer-scoped appointment (a follow-up phone call) has no
            // machine behind it, and a job sheet with no machine is not a
            // document — so the link is kept and the admin picks the machines.
            showToast("นัดหมายนี้ไม่ได้ผูกกับเครื่อง กรุณาเลือกเครื่องเอง", "error");
            return;
          }
        }
        const eqRes = await fetch(`/api/admin/equipments/${encodeURIComponent(equipmentId)}`);
        if (!eqRes.ok) throw new Error("equipment");
        const eq = await eqRes.json();
        const custRes = await fetch("/api/customers?fields=list");
        const custList: CustomerRow[] = custRes.ok ? await custRes.json() : [];
        const owner = custList.find((c) => c.id === eq.customerId);
        setCustomerId(String(eq.customerId || ""));
        setCompanyId(String(owner?.companyId || ""));
        setPicked([
          {
            equipmentId: String(eq.id),
            productName: stripHtml(eq.productName || ""),
            serialNumber: String(eq.serialNumber || ""),
          },
        ]);
      } catch {
        showToast("ดึงข้อมูลจากนัดหมาย/เครื่องไม่สำเร็จ กรุณาเลือกเอง", "error");
      } finally {
        setHydrating(false);
      }
    })();
  }, [isLoggedIn, adopt, showToast, setSnapshot]);

  // ── Dropdown options ──────────────────────────────────────────────────────
  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.name || "(ไม่มีชื่อบริษัท)" })),
    [companies]
  );

  // ผู้ติดต่อ — filtered to the chosen company. This is the second link in the
  // chain บริษัท → ผู้ติดต่อ → เครื่อง, and it is what keeps a sheet from
  // naming a contact who does not work at the company printed above him.
  const customerOptions = useMemo(
    () =>
      customers
        .filter((c) => c.companyId === companyId)
        .map((c) => ({ value: c.id, label: c.name || "(ไม่มีชื่อ)" })),
    [customers, companyId]
  );

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.equipmentId)), [picked]);

  // เครื่อง — the customer's machines, with the ones already on the sheet
  // greyed out rather than hidden, so the admin can see the machine IS there
  // and why it cannot be picked twice.
  const equipmentOptions = useMemo(() => {
    // Sort so the selected customer's equipments appear first
    const sorted = [...equipments].sort((a, b) => {
      const aIsOwner = a.customerId === customerId;
      const bIsOwner = b.customerId === customerId;
      if (aIsOwner && !bIsOwner) return -1;
      if (!aIsOwner && bIsOwner) return 1;
      return (a.productName || "").localeCompare(b.productName || "");
    });

    return sorted.map((e) => {
      const name = stripHtml(e.productName || "") || "(ไม่ทราบชื่อเครื่อง)";
      const already = pickedIds.has(e.id);
      const isOwner = e.customerId === customerId;
      
      let ownerLabel = "";
      if (!isOwner) {
        const owner = customers.find(c => c.id === e.customerId);
        ownerLabel = owner ? ` [ของ: ${owner.name}]` : " [เครื่องของลูกค้ารายอื่น]";
      }

      return {
        value: e.id,
        label: already ? `${name} — อยู่ในใบนี้แล้ว` : `${name}${ownerLabel}`,
        subLabel: `หมายเลขเครื่อง: ${e.serialNumber || "—"}`,
        disabled: already,
      };
    });
  }, [equipments, pickedIds, customerId, customers]);

  const companyName = useMemo(
    () => companies.find((c) => c.id === companyId)?.name || "",
    [companies, companyId]
  );
  const customerName = useMemo(
    () => customers.find((c) => c.id === customerId)?.name || "",
    [customers, customerId]
  );
  const customerPhone = useMemo(
    () => customers.find((c) => c.id === customerId)?.phone || "",
    [customers, customerId]
  );

  /** All contacts to display on the sheet: primary + additional. */
  const allContacts = useMemo(() => {
    const ids = [customerId, ...additionalContacts].filter(Boolean);
    const seen = new Set<string>();
    const result: { name: string; phone: string }[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const c = customers.find((r) => r.id === id);
      if (c) result.push({ name: c.name || "", phone: c.phone || "" });
    }
    return result;
  }, [customerId, additionalContacts, customers]);

  // The ruled note area grows into whatever the machine table leaves free, so a
  // one-machine sheet does not print a third of an A4 page as unusable white.
  const noteLines = useMemo(() => descriptionLines(picked.length), [picked.length]);

  // ── Machine list edits ────────────────────────────────────────────────────

  function addEquipment(equipmentId: string) {
    if (!equipmentId) return;
    if (pickedIds.has(equipmentId)) {
      showToast("เครื่องนี้อยู่ในใบงานนี้แล้ว", "error");
      return;
    }
    const row = equipments.find((e) => e.id === equipmentId);
    if (!row) {
      showToast("ไม่พบเครื่องที่เลือกในรายการของลูกค้ารายนี้", "error");
      return;
    }
    setPicked((prev) => [
      ...prev,
      {
        equipmentId: row.id,
        productName: stripHtml(row.productName || ""),
        // NEVER typed. Straight off the machine row — see the header note.
        serialNumber: String(row.serialNumber || ""),
      },
    ]);
  }

  const removeEquipment = (equipmentId: string) =>
    setPicked((prev) => prev.filter((p) => p.equipmentId !== equipmentId));

  const moveEquipment = (equipmentId: string, dir: -1 | 1) =>
    setPicked((prev) => {
      const idx = prev.findIndex((p) => p.equipmentId === equipmentId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });

  // Changing the company or the contact changes WHOSE machines may be on the
  // sheet, so the machine list cannot survive it — every row would belong to
  // somebody else. Confirmed rather than silently dropped, because the machines
  // are the slowest part of the form to refill.
  function requestCompany(value: string) {
    if (value === companyId) return;
    if (picked.length > 0) {
      setConfirmSwitchParty({ kind: "company", value });
      return;
    }
    setCompanyId(value);
    setCustomerId("");
  }

  function requestCustomer(value: string) {
    if (value === customerId) return;
    if (picked.length > 0) {
      setConfirmSwitchParty({ kind: "customer", value });
      return;
    }
    setCustomerId(value);
    // Remove from additional if it was there
    setAdditionalContacts((prev) => prev.filter((id) => id !== value));
  }

  function applyPartySwitch() {
    if (!confirmSwitchParty) return;
    setPicked([]);
    if (confirmSwitchParty.kind === "company") {
      setCompanyId(confirmSwitchParty.value);
      setCustomerId("");
      setAdditionalContacts([]);
    } else {
      setCustomerId(confirmSwitchParty.value);
      setAdditionalContacts((prev) => prev.filter((id) => id !== confirmSwitchParty!.value));
    }
    setConfirmSwitchParty(null);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  /** The same Thai messages the store would answer with, asked here so the
   * admin does not have to round-trip to find out he forgot the date. Returns
   * null when the form is good. */
  function validationError(): string | null {
    if (!companyId) return "กรุณาเลือกบริษัทลูกค้า";
    if (!customerId) return "กรุณาเลือกผู้ติดต่อ";
    if (!jobDate || !isValidDateString(jobDate)) return "กรุณาระบุวันที่ให้ถูกต้อง";
    if (picked.length === 0) return "กรุณาเลือกเครื่องอย่างน้อย 1 เครื่อง";
    return null;
  }

  /** Persist, and hand back the SAVED sheet (null if nothing was written). The
   * caller needs the returned row, not just a boolean: the job NUMBER is minted
   * by the server and only exists on that response — reading it back out of
   * component state would race the render that puts it there. */
  async function save(): Promise<ServiceJob | null> {
    if (saving || locked) return null;
    const problem = validationError();
    if (problem) {
      showToast(problem, "error");
      return null;
    }
    setSaving(true);
    const body = {
      companyId,
      customerId,
      jobDate,
      technicianName,
      scheduleId,
      equipmentIds: picked.map((p) => p.equipmentId),
      // jobNo is deliberately absent: the server owns it. It is also why the
      // leave-guard fingerprint above does not track it — there is nothing
      // about the number for the admin to change, and so nothing to lose.
    };
    try {
      const res = await fetch(
        jobId ? `/api/service-jobs/${encodeURIComponent(jobId)}` : "/api/service-jobs",
        {
          method: jobId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // The store's Thai validation messages ARE the error text (a machine
        // belonging to another customer, a bad date) — show them as they are.
        showToast(data?.error || "บันทึกใบงานบริการไม่สำเร็จ", "error");
        return null;
      }
      const saved = data as ServiceJob;
      adopt(saved);
      showToast(
        jobId ? "บันทึกการแก้ไขแล้ว" : `ออกใบงานบริการเลขที่ ${saved.jobNo || ""} แล้ว`,
        "success"
      );
      return saved;
    } catch {
      showToast("เกิดข้อผิดพลาดในการบันทึก", "error");
      return null;
    } finally {
      setSaving(false);
    }
  }

  // ── PDF ───────────────────────────────────────────────────────────────────
  //
  // The SAME machinery /quotation uses: jspdf + html2canvas-pro rasterising the
  // sheet's own DOM, both dynamically imported so they load on click and never
  // run on the server (heavy PDF/DOM libraries have broken this app on Vercel
  // before). There is deliberately no second exporter in this project.
  //
  // What is different here, and why: a quotation's footer is a totals table
  // that may sit alone on a last page without anybody minding. This document's
  // footer is the RULED DESCRIPTION AREA and the two SIGNATURE BLOCKS — the
  // part a human writes on. A page break that leaves them alone on a blank
  // second page produces a sheet whose signatures belong to no listed machine.
  // So when the footer does not fit under the last machine row, ONE machine row
  // moves down with it (see the page-break rule below) instead of the footer
  // being orphaned.
  async function generatePdf(docNo: string) {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);

    // A save immediately before this one puts the freshly-minted job number
    // into state; wait for React to actually paint it before measuring or
    // cloning, or the first sheet a new job ever prints carries the
    // "— ออกเลขที่เมื่อบันทึก —" placeholder where its number should be.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    const sheet = document.getElementById("job-sheet");
    if (!sheet) return;

    const widthPx = sheet.offsetWidth;
    const mm = (value: number) => widthPx * (value / 210);
    const PAGE_MAX_HEIGHT = mm(297) - mm(14); // A4 height less a bottom margin
    const paddingTopPx = mm(12);

    // Measure the LIVE sheet before any clone is in the document.
    const rows = Array.from(
      document.getElementById("job-tbody")?.querySelectorAll("tr") ?? []
    ) as HTMLElement[];
    const rowHeights = rows.map((r) => r.offsetHeight);
    const headerFirst = document.getElementById("job-header")?.offsetHeight ?? 0;
    const customerInfoH = document.getElementById("job-customer-info")?.offsetHeight ?? 0;
    const headerRest = headerFirst - customerInfoH; // continuation pages drop it
    const tableHeadH =
      document.getElementById("job-table")?.querySelector("thead")?.offsetHeight ?? 0;
    const footerH =
      (document.getElementById("job-notes")?.offsetHeight ?? 0) +
      (document.getElementById("job-signatures")?.offsetHeight ?? 0) +
      mm(10);

    const capacity = (pageIndex: number) =>
      PAGE_MAX_HEIGHT -
      paddingTopPx -
      tableHeadH -
      (pageIndex === 0 ? headerFirst : headerRest);

    // 1. Fill pages with machine rows, greedily.
    const plan: number[][] = [[]];
    let used = 0;
    for (let i = 0; i < rows.length; i++) {
      const page = plan[plan.length - 1];
      if (page.length > 0 && used + rowHeights[i] > capacity(plan.length - 1)) {
        plan.push([]);
        used = 0;
      }
      plan[plan.length - 1].push(i);
      used += rowHeights[i];
    }

    // 2. The page-break rule (task 5.8). The table is never cut off by the
    //    signature block — the block only ever renders on the LAST page — and
    //    the block never lands alone on an empty page: the last machine row
    //    moves down to keep it company. Only if even one row plus the footer
    //    cannot share a page does the footer get a page of its own, and only
    //    when moving a row would leave a page with no rows at all.
    const lastIdx = plan.length - 1;
    const lastPage = plan[lastIdx];
    const lastUsed = lastPage.reduce((sum, i) => sum + rowHeights[i], 0);
    if (lastPage.length > 0 && lastUsed + footerH > capacity(lastIdx)) {
      const tail = lastPage[lastPage.length - 1];
      if (lastPage.length > 1 && rowHeights[tail] + footerH <= capacity(lastIdx + 1)) {
        plan[lastIdx] = lastPage.slice(0, -1);
        plan.push([tail]);
      } else {
        plan.push([]);
      }
    }

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = `${widthPx}px`;
    document.body.appendChild(container);

    try {
      const pages = plan.map((rowIdxs, pageIndex) => {
        const clone = sheet.cloneNode(true) as HTMLElement;
        clone.id = "";
        clone.style.height = "297mm";
        clone.style.minHeight = "297mm";
        clone.style.overflow = "hidden";
        clone.style.backgroundColor = "#ffffff";

        const hide = (selector: string) => {
          const el = clone.querySelector(selector) as HTMLElement | null;
          if (el) el.style.display = "none";
        };
        if (pageIndex > 0) hide("#job-customer-info");
        if (pageIndex < plan.length - 1) {
          hide("#job-notes");
          hide("#job-signatures");
        }

        const tbody = clone.querySelector("#job-tbody") as HTMLElement | null;
        if (tbody) {
          tbody.innerHTML = "";
          for (const i of rowIdxs) tbody.appendChild(rows[i].cloneNode(true));
        }
        // A footer-only page carries no machine table at all — an empty grid
        // above a signature block reads as "no machines were serviced".
        if (rowIdxs.length === 0 && rows.length > 0) hide("#job-table");

        if (plan.length > 1) {
          const slot = clone.querySelector("#job-page-number") as HTMLElement | null;
          if (slot) slot.textContent = `หน้า ${pageIndex + 1}/${plan.length}`;
        }
        container.appendChild(clone);
        return clone;
      });

      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
        });
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pageW, pageH);
      }
      pdf.save(`ServiceJob-${(docNo || "document").replace(/[^\w.-]/g, "_")}.pdf`);
    } finally {
      document.body.removeChild(container);
    }
  }

  /** Save first (so the paper's number exists in the ledger and the sheet can
   * be found when it comes back), then download. A sheet printed under a number
   * the database has never heard of is a sheet nobody can close. */
  async function handleDownload() {
    if (generating) return;
    setGenerating(true);
    try {
      let docNo = jobNo;
      let savedId = jobId;
      if (!locked && (isDirty || !jobId)) {
        const saved = await save();
        if (!saved) return;
        // Straight off the response, not out of state: the number is minted by
        // the server and `setJobNo` has not rendered yet.
        docNo = saved.jobNo;
        savedId = saved.id;
      }
      // The last gate before paper. A number reaches this line ONLY by having
      // come back from a save, so anything missing here means the sheet in
      // front of the admin is not in the database — and a sheet printed under
      // a number the ledger never minted is a sheet nobody can close. Refuse,
      // in Thai, instead of printing something that cannot be trusted.
      if (!savedId || !docNo) {
        showToast("ยังไม่มีเลขที่ใบงาน กรุณากดบันทึกก่อนดาวน์โหลด PDF", "error");
        return;
      }
      await generatePdf(docNo);
    } catch {
      showToast("สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่", "error");
    } finally {
      setGenerating(false);
    }
  }




  if (isLoading || !isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-orange-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm";
  const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

  return (
    <>
      <div className="min-h-screen bg-gray-100">
        {toast && <Toast message={toast.message} type={toast.type} />}

        {confirmSwitchParty && (
          <ConfirmDialog
            title="เปลี่ยนลูกค้าของใบงานนี้?"
            message={`ใบงานบริการ 1 ใบใช้ได้กับลูกค้ารายเดียว — เครื่อง ${picked.length} เครื่องที่เลือกไว้จะถูกนำออกจากใบนี้ทั้งหมด`}
            confirmText="เปลี่ยนและล้างรายการเครื่อง"
            cancelText="ยกเลิก"
            onConfirm={applyPartySwitch}
            onCancel={() => setConfirmSwitchParty(null)}
          />
        )}

        {/* ── Toolbar ── */}
        <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">
                🔧 {jobId ? "ใบงานบริการ" : "สร้างใบงานบริการ"}
              </h1>
              {jobNo && (
                <span className="px-2.5 py-1 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 text-sm font-bold font-mono">
                  {jobNo}
                </span>
              )}
              {jobId && (
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${status === "completed"
                      ? "bg-green-100 text-green-700"
                      : status === "cancelled"
                        ? "bg-gray-100 text-gray-500"
                        : "bg-amber-100 text-amber-700"
                    }`}
                >
                  {STATUS_LABELS[status]}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => guardedNavigate("/adminpanel")}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
              >
                🏠 กลับไปหน้าระบบจัดการ
              </button>
              <button
                onClick={() => guardedNavigate("/service-job/saved")}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition"
              >
                📄 ใบงานบริการที่ออกแล้ว
              </button>
              {!locked && (
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-5 py-2 rounded-lg border border-green-500 text-green-600 text-sm font-bold hover:bg-green-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "กำลังบันทึก..." : jobId ? "💾 บันทึกการแก้ไข" : "💾 บันทึกและออกเลขที่ใบ"}
                </button>
              )}

              <button
                onClick={handleDownload}
                disabled={generating || saving}
                className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? "กำลังสร้าง PDF..." : "⬇️ ดาวน์โหลด PDF"}
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 py-6 grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6 items-start">
          {/* ══ LEFT: the form ══ */}
          <div className="space-y-4">
            {locked && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {status === "completed" ? (
                  <>
                    ใบงานนี้<span className="font-bold">ปิดงานแล้ว</span> — แก้ไขไม่ได้
                    เพราะถูกบันทึกเป็นประวัติการเข้าบริการของเครื่องทุกตัวในใบนี้แล้ว
                    ยังพิมพ์ซ้ำได้ตามปกติ
                  </>
                ) : (
                  <>
                    ใบงานนี้<span className="font-bold">ถูกยกเลิกแล้ว</span> — แก้ไขไม่ได้
                    แต่ยังเปิดดูและพิมพ์ได้
                  </>
                )}
              </div>
            )}

            {hydrating && (
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
                กำลังดึงข้อมูล...
              </div>
            )}

            {scheduleId && (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${scheduleGone
                    ? "border-gray-200 bg-gray-50 text-gray-600"
                    : "border-indigo-200 bg-indigo-50 text-indigo-800"
                  }`}
              >
                {scheduleGone ? (
                  <>
                    📅 นัดหมายที่ผูกไว้กับใบนี้ถูกลบไปแล้ว — ใบงานบริการยังอยู่ครบและพิมพ์ได้ตามปกติ
                  </>
                ) : (
                  <>📅 ใบนี้ผูกกับนัดหมายเดิม — เมื่อกดปิดงาน นัดหมายนั้นจะถูกปิดตามให้ด้วย</>
                )}
              </div>
            )}

            {/* ── ลูกค้า: บริษัท → ผู้ติดต่อ ─────────────────────────────────
                Both are SearchableDropdown, never a native <select>
                (AGENTS.md): a native one is painted by the operating system, so
                on a dark-mode machine it opens as a dark grey popup in the
                middle of this white form. The disabled state is a
                <fieldset disabled> wrapper — the component has no `disabled`
                prop. */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
              <h2 className="font-bold text-gray-800">ลูกค้า</h2>
              <fieldset disabled={locked} className="space-y-3 disabled:opacity-60">
                <div>
                  <label className={labelCls}>บริษัทลูกค้า *</label>
                  <SearchableDropdown
                    options={companyOptions}
                    value={companyId}
                    onChange={requestCompany}
                    placeholder="เลือกบริษัท..."
                    buttonClassName={`${inputCls} h-[38px]`}
                  />
                </div>
                <div>
                  <label className={labelCls}>ผู้ติดต่อ *</label>
                  <fieldset disabled={!companyId} className="disabled:opacity-60">
                    <SearchableDropdown
                      options={customerOptions}
                      value={customerId}
                      onChange={requestCustomer}
                      placeholder={companyId ? "เลือกผู้ติดต่อ..." : "เลือกบริษัทก่อน"}
                      buttonClassName={`${inputCls} h-[38px]`}
                    />
                  </fieldset>
                  {companyId && customerOptions.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      บริษัทนี้ยังไม่มีผู้ติดต่อในระบบ
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>ผู้ติดต่อเพิ่มเติม</label>
                  <fieldset disabled={!customerId} className="disabled:opacity-60">
                    <SearchableDropdown
                      options={customerOptions.filter(
                        (o) => o.value !== customerId && !additionalContacts.includes(o.value)
                      )}
                      value=""
                      onChange={(v) => {
                        if (v && v !== customerId && !additionalContacts.includes(v)) {
                          setAdditionalContacts((prev) => [...prev, v]);
                        }
                      }}
                      placeholder={customerId ? "เลือกผู้ติดต่อเพิ่ม..." : "เลือกผู้ติดต่อหลักก่อน"}
                      buttonClassName={`${inputCls} h-[38px]`}
                    />
                  </fieldset>
                  {additionalContacts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {additionalContacts.map((id) => {
                        const c = customers.find((r) => r.id === id);
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full border border-blue-200"
                          >
                            {c?.name || id}
                            {!locked && (
                              <button
                                type="button"
                                onClick={() => setAdditionalContacts((prev) => prev.filter((x) => x !== id))}
                                className="hover:text-red-500 transition text-blue-400"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </fieldset>
            </section>

            {/* ── วันที่ + ช่าง ───────────────────────────────────────────── */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
              <h2 className="font-bold text-gray-800">ข้อมูลใบงาน</h2>
              <fieldset disabled={locked} className="space-y-3 disabled:opacity-60">
                {/* เลขที่ใบงาน — READ-ONLY, on purpose.
                    The number is not a field the admin owns: it is a claim on
                    `used_docnos`, the shared ledger quotations (QT…) and
                    billing (INV/BN/RC) draw from and which is never purged. A
                    typed number lands in that ledger verbatim, so one typo
                    burns a number another document family needed, and a number
                    the browser chose is a number two browsers can choose. So
                    the server mints it — and this block exists so the admin
                    can still SEE what the sheet will carry before he prints. */}
                <div>
                  <label className={labelCls}>เลขที่ใบงาน (JOB NO.)</label>
                  <div
                    data-testid="job-no"
                    className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm font-mono font-bold text-gray-800"
                  >
                    {jobNo || nextJobNoPreview || "—"}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {jobNo
                      ? "ระบบออกเลขที่นี้ให้แล้ว และแก้ไขไม่ได้ — เลขที่เดียวกันนี้อยู่บนกระดาษที่ช่างถือไป"
                      : nextJobNoPreview
                        ? "ตัวอย่างเลขที่ถัดไปของวันที่เลือก ระบบจะออกเลขที่จริงตอนกดบันทึก (ถ้ามีคนบันทึกก่อน ระบบจะเลื่อนไปเลขถัดไปให้เอง)"
                        : "ระบบจะออกเลขที่ให้อัตโนมัติตอนกดบันทึก"}
                  </p>
                </div>
                <div>
                  <label className={labelCls}>วันที่เข้าบริการ *</label>
                  <DatePicker
                    selected={jobDate ? new Date(`${jobDate}T00:00:00`) : null}
                    onChange={(date) => setJobDate(date ? toLocalDateString(date) : "")}
                    placeholderText="เลือกวันที่"
                  />
                </div>
                <div>
                  <label className={labelCls}>ชื่อช่างผู้ปฏิบัติงาน (ไม่บังคับ)</label>
                  <input
                    className={inputCls}
                    value={technicianName}
                    onChange={(e) => setTechnicianName(e.target.value)}
                    placeholder="เว้นว่างไว้ก็ได้ — ให้ช่างเขียนชื่อเองบนกระดาษ"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    ถ้าเว้นว่าง เอกสารที่พิมพ์ออกมาจะมี
                    <span className="font-semibold">เส้นบรรทัดว่าง</span>
                    ให้ช่างเขียนชื่อเองหน้างาน
                  </p>
                </div>
              </fieldset>
            </section>

            {/* ── เครื่อง ─────────────────────────────────────────────────── */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-gray-800">เครื่องในใบงานนี้</h2>
                <span className="text-xs text-gray-500">{picked.length} เครื่อง</span>
              </div>
              <fieldset disabled={locked} className="space-y-3 disabled:opacity-60">
                <div>
                  <label className={labelCls}>เพิ่มเครื่อง</label>
                  <fieldset disabled={!customerId || equipmentsLoading} className="disabled:opacity-60">
                    <SearchableDropdown
                      options={equipmentOptions}
                      value=""
                      onChange={addEquipment}
                      placeholder={
                        !customerId
                          ? "เลือกผู้ติดต่อก่อน"
                          : equipmentsLoading
                            ? "กำลังโหลดเครื่อง..."
                            : "เลือกเครื่องเพื่อเพิ่มลงในใบ..."
                      }
                      buttonClassName={`${inputCls} h-[38px]`}
                    />
                  </fieldset>
                  {customerId && !equipmentsLoading && equipments.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      ลูกค้ารายนี้ยังไม่มีเครื่องในระบบ — เพิ่มเครื่องได้ที่หน้าจัดการลูกค้า
                    </p>
                  )}
                </div>

                {picked.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">
                    ยังไม่ได้เลือกเครื่อง
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {picked.map((p, idx) => (
                      <li
                        key={p.equipmentId}
                        className="flex items-start gap-2 border border-gray-200 rounded-lg p-3 bg-gray-50/60"
                      >
                        <span className="w-6 h-6 shrink-0 rounded-full bg-white border border-gray-300 text-xs font-bold text-gray-600 flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-800 break-words">
                            {p.productName || "(ไม่ทราบชื่อเครื่อง)"}
                          </div>
                          {/* Read-only, from customer_equipments. There is no
                              input for this anywhere on the page. */}
                          <div className="text-xs text-gray-500 font-mono mt-0.5">
                            หมายเลขเครื่อง: {p.serialNumber || "—"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveEquipment(p.equipmentId, -1)}
                            disabled={idx === 0}
                            title="เลื่อนขึ้น"
                            className="p-1.5 text-gray-400 hover:text-gray-700 rounded hover:bg-white disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => moveEquipment(p.equipmentId, 1)}
                            disabled={idx === picked.length - 1}
                            title="เลื่อนลง"
                            className="p-1.5 text-gray-400 hover:text-gray-700 rounded hover:bg-white disabled:opacity-30"
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            onClick={() => removeEquipment(p.equipmentId)}
                            title="นำออกจากใบนี้"
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-50"
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  ℹ️ ลำดับนี้คือลำดับที่พิมพ์บนกระดาษ — พิมพ์ซ้ำอีกครั้งก็จะเรียงเหมือนเดิม
                  หมายเลขเครื่องมาจากทะเบียนเครื่องของลูกค้าเสมอ ไม่มีช่องให้พิมพ์เอง
                </p>
              </fieldset>
            </section>
          </div>

          {/* ══ RIGHT: the A4 sheet — this is what gets printed ══ */}
          <div className="overflow-x-auto xl:sticky xl:top-[90px] xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto rounded-sm">
            <div
              id="job-sheet"
              className="bg-white shadow-lg border border-gray-200 rounded-sm mx-auto text-gray-900"
              style={{
                width: "210mm",
                minHeight: "297mm",
                padding: "12mm 14mm",
                fontSize: "13px",
                lineHeight: 1.55,
              }}
            >
              {/* ── Header: who we are, and THE JOB NUMBER ──────────────────
                  The number is boxed and large because it is the reference the
                  office quotes when the signed paper comes back through the
                  door — on a stack of twenty sheets it has to be findable at
                  arm's length. */}
              <div id="job-header">
                <div className="flex justify-between items-start gap-4 pb-3 border-b-2 border-gray-800">
                  <div className="flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/profin-logo-3.png"
                      alt="Profin Lab Scale"
                      className="shrink-0 object-contain"
                      style={{ width: "11mm", height: "auto" }}
                    />
                    <div>
                      <div className="text-lg font-bold">{COMPANY.name}</div>
                      <div className="text-xs text-gray-600">{COMPANY.nameEn}</div>
                      <div className="text-xs mt-1 max-w-[95mm] whitespace-pre-line">
                        {profile.address}
                      </div>
                      {profile.phone && <div className="text-xs mt-0.5">โทร {profile.phone}</div>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-bold tracking-wide">ใบบันทึกงานบริการ</div>
                    <div className="text-[11px] text-gray-500 tracking-widest">
                      SERVICE REPORT
                    </div>
                    <div
                      className="mt-2 inline-block rounded-lg overflow-hidden text-right"
                      style={{ minWidth: "38mm" }}
                    >
                      <div
                        className="bg-gray-800 text-white text-[8px] tracking-wider px-2.5 py-0.5 text-center font-semibold"
                      >
                        เลขที่เอกสาร / DOC NO.
                      </div>
                      <div
                        className="border-2 border-gray-800 border-t-0 rounded-b-lg px-2.5 py-1 text-center"
                      >
                        {/* The PAPER shows a minted number or nothing at all.
                            The preview above is never printed here: it is not
                            this sheet's number until the save comes back. */}
                        <div className="text-lg font-black tracking-widest leading-tight text-gray-900">
                          {jobNo || (
                            <span className="text-[9px] font-semibold tracking-normal text-gray-500">
                              — ออกเลขที่เมื่อบันทึก —
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div id="job-page-number" className="text-[11px] text-gray-500 mt-2 font-bold" />
                  </div>
                </div>

                {/* Customer block — dropped on continuation pages, so a long
                    machine list does not reprint the address block. */}
                <div id="job-customer-info" className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]">
                  <div>
                    <span className="font-bold text-gray-700">บริษัทลูกค้า: </span>
                    {companyName || <RuledBlank width="52mm" />}
                  </div>
                  <div>
                    <span className="font-bold text-gray-700">วันที่เข้าบริการ: </span>
                    {jobDate ? formatDisplayDate(jobDate) : <RuledBlank width="38mm" />}
                  </div>
                  <div className="col-span-2">
                    <span className="font-bold text-gray-700">ผู้ติดต่อ: </span>
                    {allContacts.length > 0 ? (
                      <span>
                        {allContacts.map((c, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-gray-400">, </span>}
                            {c.name}
                            {c.phone && (
                              <span className="text-gray-500 text-[11px]"> (โทร {c.phone})</span>
                            )}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <RuledBlank width="52mm" />
                    )}
                  </div>
                  <div>
                    {/* Task 5.7 — a blank technician field prints as a LINE to
                        write on, never as an empty gap. */}
                    <span className="font-bold text-gray-700">ช่างผู้ปฏิบัติงาน: </span>
                    {technicianName || <RuledBlank width="38mm" />}
                  </div>
                </div>
              </div>

              {/* ── Machine table ───────────────────────────────────────────
                  "งานที่ทำ" is EMPTY and tall on purpose: that column is where
                  the technician writes, with a pen, at the customer's site. Do
                  not fill it in from the system and do not shrink it. */}
              <table id="job-table" className="w-full mt-4 border-collapse text-[12.5px]">
                <thead>
                  <tr className="bg-gray-800 text-white">
                    <th className="border border-gray-800 px-2 py-1.5 w-[11mm]">ลำดับ</th>
                    <th className="border border-gray-800 px-2 py-1.5 text-left">ชื่อเครื่อง</th>
                    <th className="border border-gray-800 px-2 py-1.5 w-[34mm]">หมายเลขเครื่อง</th>
                    <th className="border border-gray-800 px-2 py-1.5 w-[68mm] text-left">
                      งานที่ทำ
                    </th>
                  </tr>
                </thead>
                <tbody id="job-tbody">
                  {picked.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="border border-gray-300 px-2 py-8 text-center text-gray-400"
                      >
                        — ยังไม่ได้เลือกเครื่อง —
                      </td>
                    </tr>
                  ) : (
                    picked.map((p, idx) => (
                      <tr key={p.equipmentId} className="align-top">
                        <td className="border border-gray-300 px-2 py-1.5 text-center">
                          {idx + 1}
                        </td>
                        <td className="border border-gray-300 px-2 py-1.5">
                          {p.productName || "-"}
                        </td>
                        <td className="border border-gray-300 px-2 py-1.5 text-center font-mono">
                          {p.serialNumber || "-"}
                        </td>
                        {/* Left empty for handwriting. 17mm ≈ two lines of
                            Thai handwriting with a ballpoint. */}
                        <td className="border border-gray-300 px-2 py-1.5">
                          <div style={{ minHeight: "17mm" }} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* ── General description — RULED ─────────────────────────────
                  Ruled, not blank: unlined paper makes handwriting drift and
                  scans back badly, and this is the part of the document the
                  customer later reads to see what we did. */}
              <div id="job-notes" className="mt-4">
                <div className="font-bold text-gray-800 text-[12.5px] mb-1">
                  รายละเอียดงานที่ทำ / หมายเหตุ
                </div>
                <div className="border border-gray-400" style={{ height: `${noteLines * 8.5}mm` }} />
              </div>

              {/* ── Signatures ─────────────────────────────────────────────
                  Two blocks, because the sheet is signed ON PAPER by two
                  people: the technician who did the work and the customer who
                  received it. Each gets a signature line, a printed-name line
                  and a date line. There is no signature pad in this system and
                  the signed sheet is never uploaded — the paper goes into a
                  folder ("เอากระดาษกลับมาส่ง ไม่ต้องแนบใบ"). */}
              <div id="job-signatures" className="flex justify-end mt-8 text-[12px]">
                <div className="text-center w-1/2">
                  <div className="border-b border-gray-500 h-12 mb-1.5" />
                  <div className="text-gray-500 text-[11px]">ลงชื่อ</div>
                  <div className="mt-3">
                    <RuledBlank width="42mm" />
                  </div>
                  <div className="font-bold mt-3">ลูกค้าผู้รับบริการ</div>
                  <div className="text-gray-500 mt-2">
                    วันที่ ______ / ______ / ______
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <LeaveGuardModal
        show={showModal}
        documentLabel="ใบงานบริการ"
        saving={saving}
        saveDisabled={locked || validationError() !== null}
        onSave={async () => {
          if (await save()) confirmLeave();
        }}
        onDiscard={confirmLeave}
        onCancel={cancelLeave}
      />
    </>
  );
}
