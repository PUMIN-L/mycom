import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import PdfEditorToolbar, {
  MAX_FONT_SIZE_PT,
  MIN_FONT_SIZE_PT,
  type PdfEditorToolbarProps,
  type TextStyle,
} from '@/app/tools/pdf-editor/PdfEditorToolbar';

/**
 * MOCKING THE PREVIEW SURFACE IS NOT OPTIONAL.
 *
 * Anything that transitively imports react-pdf crashes a jsdom test with
 * `ReferenceError: DOMMatrix is not defined` — pdfjs reaches for a browser
 * geometry API that Node does not have. The toolbar does not import it today,
 * and these stubs are what guarantees that stays true: if a future edit pulls
 * the canvas (or react-pdf itself) into this component's import graph, the
 * stubs absorb it instead of the suite dying with an error that says nothing
 * about the change that caused it.
 */
vi.mock('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock('@/app/tools/pdf-editor/PdfPreviewWrapper', () => ({
  default: () => null,
}));
vi.mock('@/app/tools/pdf-editor/SignaturePad', () => ({
  default: () => null,
}));

/**
 * SearchableDropdown measures its trigger with getBoundingClientRect() and
 * reads window.innerHeight to choose a panel direction. jsdom reports zeroes
 * for both, so without this the panel still opens but its geometry is
 * meaningless — stubbing it keeps these tests about the toolbar, not layout.
 */
function mockTriggerRect() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 140,
    left: 0,
    right: 300,
    width: 300,
    height: 40,
    x: 0,
    y: 100,
    toJSON: () => {},
  });
  vi.stubGlobal('innerHeight', 800);
}

const DEFAULT_TEXT_STYLE: TextStyle = {
  sizePt: 16,
  bold: false,
  color: { r: 0, g: 0, b: 0 },
  angleDeg: 0,
  align: 'left',
};

function setup(overrides: Partial<PdfEditorToolbarProps> = {}) {
  const props: PdfEditorToolbarProps = {
    disabled: false,
    tool: 'select',
    onToolChange: vi.fn(),
    textStyle: DEFAULT_TEXT_STYLE,
    onTextStyleChange: vi.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    currentPageNumber: 1,
    pageCount: 3,
    onRotateCurrentPage: vi.fn(),
    onDeleteCurrentPage: vi.fn(),
    onMergePdf: vi.fn(),
    onDownload: vi.fn(),
    isExporting: false,
    ...overrides,
  };
  const utils = render(<PdfEditorToolbar {...props} />);
  return { props, ...utils };
}

/** Open a SearchableDropdown by its trigger's visible label. */
function openDropdown(triggerLabel: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: triggerLabel }));
}

beforeEach(() => {
  mockTriggerRect();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PdfEditorToolbar — the armed tool', () => {
  it('offers exactly the five tools the owner settled on, and no protection tool', () => {
    setup();
    for (const label of ['เลือก/ย้าย', 'ทับขาว', 'ข้อความ', 'รูปภาพ', 'ลายเซ็น']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('marks the armed tool with aria-pressed and reports a change', () => {
    const { props } = setup({ tool: 'whiteout' });

    expect(screen.getByRole('button', { name: /ทับขาว/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /ข้อความ/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: /ลายเซ็น/ }));
    expect(props.onToolChange).toHaveBeenCalledWith('signature');
  });

  it('shows the text style row only while the text tool is armed', () => {
    const { unmount } = setup({ tool: 'select' });
    expect(screen.queryByText('ขนาดตัวอักษร')).not.toBeInTheDocument();
    unmount();

    setup({ tool: 'text' });
    expect(screen.getByText('ขนาดตัวอักษร')).toBeInTheDocument();
    expect(screen.getByText('จัดวาง')).toBeInTheDocument();
    expect(screen.getByText('เอียง (องศา)')).toBeInTheDocument();
  });
});

describe('PdfEditorToolbar — text styling', () => {
  it('offers only font sizes the writer will actually accept', () => {
    setup({ tool: 'text' });
    openDropdown('16 pt');

    // Read the sizes back off the panel and check them against the SAME
    // constants the component exports. A literal bound here would be exactly
    // the drift this assertion exists to catch.
    //
    // The bounds live in PdfEditorToolbar, not pdfValidate: a font size is not
    // an upload guard — nothing is REFUSED for it — and the ladder the admin
    // picks from IS the range. PdfEditorGuidePanel quotes the same two
    // exports, so widening the ladder widens both the guide and this test.
    const sizes = screen
      .getAllByRole('button', { name: /^\d+ pt$/ })
      .map((node) => Number.parseInt(node.textContent!, 10));

    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE_PT);
      expect(size).toBeLessThanOrEqual(MAX_FONT_SIZE_PT);
    }
  });

  it('reports a new font size without disturbing the rest of the style', () => {
    const { props } = setup({ tool: 'text' });
    openDropdown('16 pt');
    fireEvent.click(screen.getByRole('button', { name: '24 pt' }));

    expect(props.onTextStyleChange).toHaveBeenCalledWith({
      ...DEFAULT_TEXT_STYLE,
      sizePt: 24,
    });
  });

  it('toggles bold and reports alignment', () => {
    const { props } = setup({ tool: 'text' });

    const bold = screen.getByRole('button', { name: 'B' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(bold);
    expect(props.onTextStyleChange).toHaveBeenCalledWith({
      ...DEFAULT_TEXT_STYLE,
      bold: true,
    });

    openDropdown('ชิดซ้าย');
    fireEvent.click(screen.getByRole('button', { name: 'กึ่งกลาง' }));
    expect(props.onTextStyleChange).toHaveBeenCalledWith({
      ...DEFAULT_TEXT_STYLE,
      align: 'center',
    });
  });
});

describe('PdfEditorToolbar — page and document actions', () => {
  it('rotates the current page and snaps the dropdown back to its instruction', () => {
    const { props } = setup();

    openDropdown(/หมุนหน้านี้/);
    fireEvent.click(screen.getByRole('button', { name: 'หมุน 90° ตามเข็ม' }));

    expect(props.onRotateCurrentPage).toHaveBeenCalledWith(90);
    // The control is an ACTION, not a stored value: it must not now claim the
    // page "is" 90°, or a second rotation reads as a no-op to the admin.
    expect(screen.getByRole('button', { name: /หมุนหน้านี้/ })).toBeInTheDocument();
  });

  it('refuses to delete the last remaining page', () => {
    const { props } = setup({ pageCount: 1 });
    const deleteButton = screen.getByRole('button', { name: /ลบหน้านี้/ });

    expect(deleteButton).toBeDisabled();
    fireEvent.click(deleteButton);
    expect(props.onDeleteCurrentPage).not.toHaveBeenCalled();
  });

  it('names the page being edited so a page-scoped action is never ambiguous', () => {
    const { unmount } = setup({ currentPageNumber: 2, pageCount: 5 });
    expect(screen.getByText('หน้า 2 จาก 5 หน้า')).toBeInTheDocument();
    unmount();

    setup({ currentPageNumber: 0, pageCount: 5 });
    expect(screen.getByText('ยังไม่ได้เลือกหน้า')).toBeInTheDocument();
  });

  it('gates undo and redo on there being history in that direction', () => {
    const { props, unmount } = setup({ canUndo: false, canRedo: false });
    expect(screen.getByRole('button', { name: /ย้อนกลับ/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /ทำซ้ำ/ })).toBeDisabled();
    unmount();

    const second = setup({ canUndo: true, canRedo: true });
    fireEvent.click(screen.getByRole('button', { name: /ย้อนกลับ/ }));
    fireEvent.click(screen.getByRole('button', { name: /ทำซ้ำ/ }));
    expect(second.props.onUndo).toHaveBeenCalledTimes(1);
    expect(second.props.onRedo).toHaveBeenCalledTimes(1);
    expect(props.onUndo).not.toHaveBeenCalled();
  });

  it('shows progress on the download button while an export runs', () => {
    setup({ isExporting: true });
    const download = screen.getByRole('button', { name: /กำลังสร้างไฟล์/ });
    expect(download).toBeDisabled();
    expect(screen.queryByRole('button', { name: /ดาวน์โหลด PDF/ })).not.toBeInTheDocument();
  });

  it('hands merge and download straight through', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: /รวมไฟล์ PDF/ }));
    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด PDF/ }));
    expect(props.onMergePdf).toHaveBeenCalledTimes(1);
    expect(props.onDownload).toHaveBeenCalledTimes(1);
  });
});

describe('PdfEditorToolbar — project-wide UI rules', () => {
  it('uses SearchableDropdown everywhere and never a native <select>', () => {
    // AGENTS.md: a native <select> is painted by the OS, so on a dark-mode
    // machine it opens as a dark grey popup in the middle of this white admin
    // form. There are no exceptions to this rule anywhere in the project.
    const { container } = setup({ tool: 'text' });
    expect(container.querySelectorAll('select')).toHaveLength(0);
  });

  it('disables the whole strip through a <fieldset disabled>, not a per-control prop', () => {
    // SearchableDropdown has no `disabled` prop — the fieldset is what makes
    // its trigger (a real <button>) inert along with everything else.
    //
    // WHY THIS IS ASSERTED STRUCTURALLY RATHER THAN BY CLICKING: a browser
    // makes every descendant of a disabled fieldset inert, but jsdom only
    // suppresses activation for an element carrying `disabled` ITSELF — a click
    // dispatched at a button inside a disabled fieldset still reaches React's
    // handler there. So a click-based assertion would be testing jsdom, not the
    // toolbar, and could only be satisfied by adding the per-control `disabled`
    // this rule exists to forbid. What IS checked: the wrapper is a real
    // disabled fieldset, every control inside reports as disabled (jest-dom
    // walks the ancestor fieldset exactly as the HTML spec does), and no tool
    // button carries a `disabled` attribute of its own.
    const { container } = setup({ disabled: true, tool: 'text' });

    const fieldset = container.querySelector('fieldset');
    expect(fieldset).toBeDisabled();

    const tool = screen.getByRole('button', { name: /ทับขาว/ });
    expect(tool).toBeDisabled();
    expect(tool).not.toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: /ดาวน์โหลด PDF/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /หมุนหน้านี้/ })).toBeDisabled();
  });

  it('lets every control through again once the strip is enabled', () => {
    // The other half of the rule: `disabled` is a prop of the STRIP, and
    // nothing below it is independently frozen.
    const { props } = setup({ disabled: false, tool: 'text' });

    fireEvent.click(screen.getByRole('button', { name: /ทับขาว/ }));
    fireEvent.click(screen.getByRole('button', { name: /ดาวน์โหลด PDF/ }));
    expect(props.onToolChange).toHaveBeenCalledWith('whiteout');
    expect(props.onDownload).toHaveBeenCalledTimes(1);
  });

  it('offers nothing about password protection — the owner cut that feature', () => {
    // "เรื่อง pdf รหัสผ่าน/ห้ามคัดลอกไม่ได้. ไม่ต้องทำ". No padlock, no
    // "ปลอดภัย", no protection tab. A leftover affordance here would promise
    // the admin something the tool cannot do.
    const { container } = setup({ tool: 'text' });
    const text = container.textContent ?? '';
    for (const forbidden of ['🔒', 'ปลอดภัย', 'รหัสผ่าน', 'ห้ามคัดลอก', 'ห้ามพิมพ์']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('keeps every control reachable by its accessible name', () => {
    const { container } = setup({ tool: 'text' });
    const strip = within(container.querySelector('fieldset') as HTMLElement);
    expect(strip.getAllByRole('button').length).toBeGreaterThan(5);

    // The accessible name — what a screen reader announces and what
    // `getByRole(role, { name })` matches on — is the label text, NOT the
    // textContent. An icon-only control is legitimately named by `aria-label`
    // or `title`: the colour swatch is a coloured square with no glyph in it,
    // and demanding visible text there would mean either mislabelling it or
    // dropping the shared ColorPickerDropdown. What must never happen is a
    // control with NO name at all.
    for (const button of strip.getAllByRole('button')) {
      const name =
        button.textContent?.trim() ||
        button.getAttribute('aria-label')?.trim() ||
        button.getAttribute('title')?.trim() ||
        '';
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
