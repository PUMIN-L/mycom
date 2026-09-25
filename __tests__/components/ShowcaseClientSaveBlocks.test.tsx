/**
 * Showcase editor — block operations that PERSIST IMMEDIATELY (reorder, delete)
 * must never report success for a save that did not land.
 *
 * `saveBlocks` used to do `if (res.ok) { ... }` with no else, so it resolved
 * normally on a 401/500. Every caller awaits it inside a try/catch and then
 * shows a success toast on the next line, which meant an expired session
 * produced: the block visibly moved, "ลบข้อความแล้ว" on a failed delete, and
 * nothing at all to say the database still held the old order. The admin only
 * found out on the next reload.
 */

import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/showcase/c1",
  useSearchParams: () => new URLSearchParams(),
}));

let mockIsLoggedIn = true;
vi.mock("@/app/context/AuthContext", () => ({
  useAuth: () => ({ isLoggedIn: mockIsLoggedIn }),
}));
vi.mock("@/app/i18n/LanguageContext", () => ({
  useLanguage: () => ({ lang: "th", setLang: vi.fn() }),
}));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/Footer", () => ({ default: () => null }));

import ShowcaseClient from "@/app/showcase/[id]/ShowcaseClient";
import type { ContentBlock } from "@/app/lib/types";

const BLOCKS: ContentBlock[] = [
  { id: "b1", type: "text", content: "บล็อกแรก", fontSize: "16" } as ContentBlock,
  { id: "b2", type: "text", content: "บล็อกที่สอง", fontSize: "16" } as ContentBlock,
];

function renderEditor(put: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/contents/") && init?.method === "PUT") return put();
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ShowcaseClient
      initialContent={{
        id: "c1",
        title: "หัวข้อทดสอบ",
        blocks: BLOCKS.map((b) => ({ ...b })),
        createdAt: "2026-09-01",
        productId: null,
      }}
      initialAllContents={[]}
      initialProducts={[]}
      initialCategories={[]}
      companyInfo={{ email: "x@y.z", phone: "0", address: "ที่อยู่" }}
      maintenanceOn={false}
    />
  );
  return fetchMock;
}

const ok = () =>
  ({ ok: true, status: 200, json: async () => ({ id: "c1" }) }) as unknown as Response;
const unauthorized = () =>
  ({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) }) as unknown as Response;
const serverError = () =>
  ({
    ok: false,
    status: 500,
    json: async () => ({ error: "บันทึกเนื้อหาไม่สำเร็จ" }),
  }) as unknown as Response;

/** Enters edit mode, which is where ▲ / ▼ / ✕ live. */
async function enterEditMode() {
  fireEvent.click(await screen.findByRole("button", { name: /แก้ไข$/ }));
  await waitFor(() => expect(screen.getAllByTitle("เลื่อนบล็อกลง").length).toBe(2));
}

/** The blocks currently on screen, top to bottom. */
function blockOrder(): string[] {
  return Array.from(document.querySelectorAll('[id^="block-"]')).map((el) => el.id);
}

/** The page's Toast renders as a fixed, animated panel; its text is the only
 *  thing the admin is told about a failed background save. */
function toastText(): string {
  return document.querySelector(".animate-slideUp")?.textContent ?? "";
}

beforeEach(() => {
  mockIsLoggedIn = true;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ShowcaseClient — reordering blocks (moveBlock)", () => {
  it("keeps the new order when the PUT succeeds", async () => {
    const fetchMock = renderEditor(ok);
    await enterEditMode();

    expect(blockOrder()).toEqual(["block-b1", "block-b2"]);
    fireEvent.click(screen.getAllByTitle("เลื่อนบล็อกลง")[0]);

    await waitFor(() => expect(blockOrder()).toEqual(["block-b2", "block-b1"]));
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PUT")!;
    expect(JSON.parse(String((put[1] as RequestInit).body)).blocks.map((b: ContentBlock) => b.id))
      .toEqual(["block-b2".slice(6), "block-b1".slice(6)]);
  });

  it("PUTS THE ORDER BACK and says why when the session has expired", async () => {
    // The scenario from the report: the admin clicks ▲, the PUT answers 401
    // from requireAuth(), and the old code left the swapped order on screen
    // with no toast at all.
    renderEditor(unauthorized);
    await enterEditMode();

    fireEvent.click(screen.getAllByTitle("เลื่อนบล็อกลง")[0]);

    await waitFor(() => expect(toastText()).toMatch(/เรียงลำดับบล็อกไม่สำเร็จ/));
    // Thai, and actionable — not the route's English "Unauthorized".
    expect(toastText()).toMatch(/เซสชันหมดอายุ/);
    expect(toastText()).not.toMatch(/Unauthorized/);
    // The screen agrees with the database again.
    expect(blockOrder()).toEqual(["block-b1", "block-b2"]);
  });

  it("surfaces the route's own Thai message on a non-auth failure", async () => {
    renderEditor(serverError);
    await enterEditMode();

    fireEvent.click(screen.getAllByTitle("เลื่อนบล็อกลง")[0]);

    await waitFor(() => expect(toastText()).toMatch(/บันทึกเนื้อหาไม่สำเร็จ/));
    expect(blockOrder()).toEqual(["block-b1", "block-b2"]);
  });
});

describe("ShowcaseClient — deleting a block", () => {
  async function confirmDelete() {
    fireEvent.click(screen.getAllByTitle("ลบบล็อกนี้")[0]);
    const dialog = await screen.findByRole("dialog").catch(() => null);
    const scope = dialog ? within(dialog) : screen;
    fireEvent.click(await scope.findByRole("button", { name: /^ลบ/ }));
  }

  it('does not say "ลบข้อความแล้ว" when the delete never reached the database', async () => {
    renderEditor(unauthorized);
    await enterEditMode();

    await confirmDelete();

    await waitFor(() => expect(toastText()).toMatch(/ลบบล็อกไม่สำเร็จ/));
    expect(toastText()).not.toMatch(/ลบข้อความแล้ว/);
    // The block is back: it was never actually deleted.
    expect(blockOrder()).toEqual(["block-b1", "block-b2"]);
  });

  it("reports success and removes the block when the PUT lands", async () => {
    renderEditor(ok);
    await enterEditMode();

    await confirmDelete();

    await waitFor(() => expect(blockOrder()).toEqual(["block-b2"]));
    expect(toastText()).toMatch(/ลบข้อความแล้ว/);
  });
});

/**
 * The same guarantee for the three IMAGE operations, which are optimistic in
 * exactly the same way. `saveBlocks` throwing is only half the cure: the
 * picture was already put on screen before the save was attempted, so a
 * refused save that leaves it there shows a gallery the database does not
 * have — the identical divergence, one handler along.
 */
describe("ShowcaseClient — adding an image block", () => {
  /** The hidden file input behind the 🖼️ เพิ่มรูปภาพ button. */
  function dropFile() {
    const inputs = Array.from(
      document.querySelectorAll('input[type="file"]')
    ) as HTMLInputElement[];
    // [0] replace-image, [1] add-image, [2] gallery — the order they are
    // declared in, and the add button is the middle one.
    const file = new File(["x"], "pic.png", { type: "image/png" });
    fireEvent.change(inputs[1], { target: { files: [file] } });
  }

  it("TAKES THE PICTURE BACK OFF and says why when the session has expired", async () => {
    renderEditor(unauthorized);
    await enterEditMode();

    dropFile();

    await waitFor(() => expect(toastText()).toMatch(/เพิ่มรูปไม่สำเร็จ/));
    expect(toastText()).toMatch(/เซสชันหมดอายุ/);
    expect(toastText()).not.toMatch(/เพิ่มรูปภาพสำเร็จ/);
    // Two blocks, exactly as before — the new one never reached the database.
    expect(blockOrder()).toEqual(["block-b1", "block-b2"]);
  });

  it("keeps the new block when the PUT lands", async () => {
    renderEditor(ok);
    await enterEditMode();

    dropFile();

    await waitFor(() => expect(blockOrder()).toHaveLength(3));
    expect(toastText()).toMatch(/เพิ่มรูปภาพสำเร็จ/);
  });
});

// After an auto-persisting block operation the editor's `content` baseline is
// what the SERVER stored, never the local editor copy: view mode renders
// `content` as HTML, and local editor output has not been through the
// server's sanitizer (quill 2.0.3 has an open advisory on its HTML export).
/** Waits until the block PUT has been sent and its reply applied. */
async function savedWith(fetchMock: ReturnType<typeof renderEditor>) {
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PUT")).toBe(true)
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("ShowcaseClient — the saved baseline is the server's copy", () => {
  it("shows what the server stored once the admin leaves edit mode", async () => {
    const serverCopy = {
      id: "c1",
      title: "<p>หัวข้อที่เซิร์ฟเวอร์เก็บ</p>",
      blocks: [
        { id: "b2", type: "text", content: "<p>บล็อกที่สอง (เก็บแล้ว)</p>", fontSize: "16" },
        { id: "b1", type: "text", content: "<p>บล็อกแรก (เก็บแล้ว)</p>", fontSize: "16" },
      ],
      createdAt: "2026-09-01",
      productId: null,
    };
    const fetchMock = renderEditor(() => ({ ok: true, status: 200, json: async () => serverCopy }) as unknown as Response);
    await enterEditMode();

    fireEvent.click(screen.getAllByTitle("เลื่อนบล็อกลง")[0]);
    await savedWith(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("หัวข้อที่เซิร์ฟเวอร์เก็บ"));
    expect(document.body.textContent).toContain("บล็อกแรก (เก็บแล้ว)");
    expect(blockOrder()).toEqual(["block-b2", "block-b1"]);
  });

  it("keeps the previous baseline, not the local copy, when the reply is not a content row", async () => {
    const fetchMock = renderEditor(ok); // replies { id } only
    await enterEditMode();

    fireEvent.click(screen.getAllByTitle("เลื่อนบล็อกลง")[0]);
    await savedWith(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("หัวข้อทดสอบ"));
  });
});
