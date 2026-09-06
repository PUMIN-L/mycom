import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * MOCKING THE PREVIEW SURFACE IS NOT OPTIONAL.
 *
 * Anything that transitively imports react-pdf crashes a jsdom test with
 * `ReferenceError: DOMMatrix is not defined`. The editor page reaches the
 * canvas through `PdfPreviewWrapper`, which does the
 * `dynamic(..., { ssr: false })` itself, so react-pdf is never rendered in
 * these tests — but the module graph is still walked, and one stray static
 * import inside that chain would take the whole suite down with an error that
 * names none of this. These stubs are the guard rail. Same for the signature
 * pad, which is a <canvas> surface and is mounted (closed) on every render.
 */
vi.mock('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock('@/app/tools/pdf-editor/PdfPreviewWrapper', () => ({
  default: () => <div data-testid="pdf-canvas" />,
}));
vi.mock('@/app/tools/pdf-editor/SignaturePad', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="signature-pad" /> : null,
}));

// The read and write halves are only ever reached through a lazy `import()`
// inside an event handler. Stubbed so a page-level test can never accidentally
// boot pdf-lib (or fetch the Sarabun font it embeds).
vi.mock('@/app/lib/pdfFormFill', () => ({
  openPdfDocument: vi.fn(async () => ({ getPages: () => [] })),
  hasXfaEntry: vi.fn(async () => false),
  listFormFields: vi.fn(async () => []),
}));
vi.mock('@/app/lib/pdfApplyEdits', () => ({
  applyEdits: vi.fn(async () => new Uint8Array()),
}));

const replace = vi.fn();
const push = vi.fn();

// The global mock in __tests__/setup.ts hands back a FRESH router object on
// every call, so a spy taken from it can never be asserted against. This one is
// stable for the life of the test file.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/tools/pdf-editor',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

const auth = { isLoggedIn: false, isLoading: true };
vi.mock('@/app/context/AuthContext', () => ({
  useAuth: () => auth,
}));

import PdfEditorPage from '@/app/tools/pdf-editor/page';

function setAuth(next: { isLoggedIn: boolean; isLoading: boolean }) {
  auth.isLoggedIn = next.isLoggedIn;
  auth.isLoading = next.isLoading;
}

/** The chrome that only ever exists once the gate has been passed. */
function editorChrome() {
  return screen.queryByRole('link', { name: /กลับไป Admin Panel/ });
}

/**
 * The guide has TWO entry points on the upload step — the header button and a
 * plain-language prompt under the drop zone ("ไม่แน่ใจว่าทำอะไรได้บ้าง?") — so
 * the name alone is ambiguous. The header one is the canonical trigger, and it
 * is the one that carries the dialog semantics, so that is what identifies it.
 */
function guideTrigger(): HTMLElement {
  const triggers = screen
    .getAllByRole('button', { name: /คู่มือการใช้งาน/ })
    .filter((node) => node.getAttribute('aria-haspopup') === 'dialog');
  expect(triggers).toHaveLength(1);
  return triggers[0];
}

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
});

describe('PDF editor — the auth gate', () => {
  it('shows only a spinner while the session is still being resolved', () => {
    setAuth({ isLoggedIn: false, isLoading: true });
    const { container } = render(<PdfEditorPage />);

    // The early return is the load-bearing half of this pattern: without it
    // the editor paints for a frame before the redirect lands, which on a slow
    // connection is long enough for a logged-out visitor to read the page.
    expect(editorChrome()).not.toBeInTheDocument();
    expect(screen.queryByText(/ลากไฟล์ PDF มาวางที่นี่/)).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();

    // Nothing is decided yet, so nothing is redirected yet.
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects a logged-out visitor to /login and renders no editor', () => {
    setAuth({ isLoggedIn: false, isLoading: false });
    render(<PdfEditorPage />);

    expect(replace).toHaveBeenCalledWith('/login');
    expect(editorChrome()).not.toBeInTheDocument();
    expect(screen.queryByText(/ลากไฟล์ PDF มาวางที่นี่/)).not.toBeInTheDocument();
  });

  it('renders the admin shell and the upload step for a logged-in admin', () => {
    setAuth({ isLoggedIn: true, isLoading: false });
    render(<PdfEditorPage />);

    expect(replace).not.toHaveBeenCalled();
    expect(editorChrome()).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /เครื่องมือแก้ไข PDF/ })
    ).toBeInTheDocument();
    expect(screen.getByText(/ลากไฟล์ PDF มาวางที่นี่/)).toBeInTheDocument();
  });

  it('keeps the shared admin chrome so the page does not look like another app', () => {
    setAuth({ isLoggedIn: true, isLoading: false });
    const { container } = render(<PdfEditorPage />);

    expect(container.querySelector('.min-h-screen.bg-gray-50\\/50')).toBeInTheDocument();
    expect(container.querySelector('.sticky.top-0')).toBeInTheDocument();
    expect(container.querySelector('.max-w-7xl.mx-auto')).toBeInTheDocument();
    expect(
      container.querySelector('h1.text-2xl.font-bold.tracking-tight')
    ).toBeInTheDocument();
  });

  it('does not render the canvas until a file has actually been opened', () => {
    setAuth({ isLoggedIn: true, isLoading: false });
    render(<PdfEditorPage />);
    expect(screen.queryByTestId('pdf-canvas')).not.toBeInTheDocument();
  });
});

describe('PDF editor — the in-page guide', () => {
  beforeEach(() => {
    setAuth({ isLoggedIn: true, isLoading: false });
  });

  it('is closed by default and its trigger announces the dialog it opens', () => {
    render(<PdfEditorPage />);

    const trigger = guideTrigger();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on the trigger, closes on Escape, and never touches the URL', () => {
    render(<PdfEditorPage />);

    fireEvent.click(guideTrigger());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(guideTrigger()).toHaveAttribute('aria-expanded', 'true');

    // Opening the guide is a plain boolean, not a route: an admin who opens it
    // mid-edit must come back to exactly the document he left.
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('answers all three of the owner’s questions', () => {
    render(<PdfEditorPage />);
    fireEvent.click(guideTrigger());

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent!.replace(/\s+/g, ' ').trim());

    for (const heading of ['ทำอะไรได้', 'ทำยังไง', 'ข้อจำกัด']) {
      expect(headings.some((actual) => actual.includes(heading))).toBe(true);
    }
  });

  it('states plainly that white-out is NOT deletion', () => {
    // The single most consequential line in the whole feature. Redaction was
    // cut, and an admin who assumes a white box removes the text underneath
    // will send a customer a file whose original contents come straight back
    // out with copy-paste. If this assertion ever has to be relaxed, the
    // feature is misleading someone.
    render(<PdfEditorPage />);
    fireEvent.click(guideTrigger());

    const guide = screen.getByRole('dialog').textContent!.replace(/\s+/g, ' ');
    expect(guide).toContain('ไม่ใช่การลบข้อมูล');
    expect(guide).toContain('ข้อความเดิมยังอยู่ในไฟล์');
  });

  it('states the four honest editing limits', () => {
    render(<PdfEditorPage />);
    fireEvent.click(guideTrigger());
    const guide = screen.getByRole('dialog').textContent!.replace(/\s+/g, ' ');

    // Text does not reflow; tables cannot grow; new text is always Sarabun;
    // a white box is visible on a non-white background.
    expect(guide).toContain('ข้อความไม่ไหลตาม');
    expect(guide).toContain('ตารางไม่ขยาย');
    expect(guide).toContain('Sarabun');
    expect(guide).toContain('เห็นเป็นแถบขาว');
  });

  it('says outright that the tool adds no password and no copy/print restriction', () => {
    render(<PdfEditorPage />);
    fireEvent.click(guideTrigger());
    const guide = screen.getByRole('dialog').textContent!.replace(/\s+/g, ' ');

    expect(guide).toContain('ไม่ได้ใส่รหัสผ่าน');
    expect(guide).toContain('ไม่ได้ห้ามพิมพ์/คัดลอก');
  });

  it('keeps the close button out of the scrolling body, and offers a second way out', () => {
    render(<PdfEditorPage />);
    fireEvent.click(guideTrigger());

    const dialog = screen.getByRole('dialog');
    const scroller = dialog.querySelector('.overflow-y-auto') as HTMLElement;

    // The header icon and the button at the foot of the panel are two elements
    // with the SAME purpose and therefore the same accessible name — one for a
    // reader who wants out immediately, one for a reader who read to the end.
    const closers = screen.getAllByRole('button', { name: /ปิดคู่มือ/ });
    expect(closers.length).toBeGreaterThanOrEqual(2);

    expect(scroller).toBeInTheDocument();
    // NEITHER of them may sit inside the scrolling body, or a way out
    // disappears the moment the admin scrolls.
    for (const closer of closers) expect(scroller.contains(closer)).toBe(false);
    expect(scroller.className).toContain('overscroll-contain');

    fireEvent.click(closers[closers.length - 1]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no password/protection affordance anywhere on the page', () => {
    const { container } = render(<PdfEditorPage />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('🔒');
    expect(text).not.toContain('ปลอดภัย');
    // The word "รหัสผ่าน" appears only as a REFUSAL (an encrypted upload cannot
    // be opened), never as something this tool offers to add.
    expect(text).not.toContain('ใส่รหัสผ่านให้ไฟล์');
  });
});
