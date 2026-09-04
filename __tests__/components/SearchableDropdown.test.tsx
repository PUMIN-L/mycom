import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import SearchableDropdown from '@/app/components/SearchableDropdown';

const options = [
  { value: 'a', label: 'ค่าน้ำ/ค่าไฟ' },
  { value: 'b', label: 'ค่าเดินทาง' },
  { value: 'c', label: 'ค่าโฆษณา/การตลาด' },
];

// Stubs the trigger's on-screen position/size so recalcPanelPosition() (which
// reads getBoundingClientRect() + window.innerHeight) sees a specific amount
// of space above/below it, without a real layout engine.
function mockTriggerRect(rect: { top: number; bottom: number }, innerHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: rect.top,
    bottom: rect.bottom,
    left: 0,
    right: 300,
    width: 300,
    height: rect.bottom - rect.top,
    x: 0,
    y: rect.top,
    toJSON: () => {},
  });
  vi.stubGlobal('innerHeight', innerHeight);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SearchableDropdown', () => {
  it('opens on click and lists the options', () => {
    mockTriggerRect({ top: 100, bottom: 140 }, 800);
    render(<SearchableDropdown options={options} value="" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /select/i }));

    expect(screen.getByText('ค่าน้ำ/ค่าไฟ')).toBeInTheDocument();
    expect(screen.getByText('ค่าเดินทาง')).toBeInTheDocument();
  });

  it('calls onChange and closes when an option is picked', () => {
    mockTriggerRect({ top: 100, bottom: 140 }, 800);
    const onChange = vi.fn();
    render(<SearchableDropdown options={options} value="" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    fireEvent.click(screen.getByText('ค่าเดินทาง'));

    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByText('ค่าน้ำ/ค่าไฟ')).not.toBeInTheDocument();
  });

  it('opens downward with a full-height panel when there is plenty of room below', () => {
    mockTriggerRect({ top: 100, bottom: 140 }, 800); // ~650px below
    render(<SearchableDropdown options={options} value="" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /select/i }));

    const panel = screen.getByText('ค่าน้ำ/ค่าไฟ').closest('div.fixed') as HTMLElement;
    expect(panel.style.top).toBe('144px'); // rect.bottom (140) + 4
    expect(panel.style.bottom).toBe('');
    expect(panel.style.maxHeight).toBe('288px');
  });

  it('flips upward and shrinks to fit when there is not enough room below the trigger', () => {
    // Trigger sits near the bottom of an 800px-tall viewport: only ~12px
    // below it, but ~692px above — this is exactly the case that used to
    // spill the panel past a modal's bottom edge instead of fitting it.
    mockTriggerRect({ top: 700, bottom: 740 }, 800);
    render(<SearchableDropdown options={options} value="" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /select/i }));

    const panel = screen.getByText('ค่าน้ำ/ค่าไฟ').closest('div.fixed') as HTMLElement;
    expect(panel.style.bottom).toBe('104px'); // (800 - 700) + 4
    expect(panel.style.top).toBe('');
    expect(panel.style.maxHeight).toBe('288px'); // capped, plenty of room above
  });

  it('shrinks the downward panel to the actual space available instead of spilling past it', () => {
    // Only ~100px below the trigger, and even less above — nowhere good to
    // flip to, so it opens down but must not claim more than what's there.
    mockTriggerRect({ top: 50, bottom: 90 }, 200);
    render(<SearchableDropdown options={options} value="" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /select/i }));

    const panel = screen.getByText('ค่าน้ำ/ค่าไฟ').closest('div.fixed') as HTMLElement;
    expect(panel.style.top).toBe('94px'); // rect.bottom (90) + 4
    // spaceBelow = 200 - 90 - 8 = 102
    expect(panel.style.maxHeight).toBe('102px');
  });

  it('renders the panel outside the trigger\'s DOM subtree (portaled to body) so an ancestor with overflow-hidden cannot clip it', () => {
    mockTriggerRect({ top: 100, bottom: 140 }, 800);
    const { container } = render(
      <div style={{ overflow: 'hidden' }}>
        <SearchableDropdown options={options} value="" onChange={vi.fn()} />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: /select/i }));

    const panel = screen.getByText('ค่าน้ำ/ค่าไฟ').closest('div.fixed') as HTMLElement;
    expect(container.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
  });

  it('does not close when clicking inside the portaled panel', () => {
    mockTriggerRect({ top: 100, bottom: 140 }, 800);
    render(<SearchableDropdown options={options} value="" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /select/i }));
    fireEvent.mouseDown(screen.getByPlaceholderText('ค้นหา...'));

    expect(screen.getByText('ค่าน้ำ/ค่าไฟ')).toBeInTheDocument();
  });
});
