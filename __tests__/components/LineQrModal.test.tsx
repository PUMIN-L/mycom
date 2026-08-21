import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LineQrModal from '@/app/components/LineQrModal';
import { LINE_ID } from '@/app/lib/contact';

describe('LineQrModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <LineQrModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders QR code modal content when isOpen is true', () => {
    const onClose = vi.fn();
    render(<LineQrModal isOpen={true} onClose={onClose} />);

    expect(screen.getByText('ติดต่อเราผ่าน LINE')).toBeInTheDocument();
    expect(screen.getByText(LINE_ID)).toBeInTheDocument();
    expect(screen.getByText(/เปิด LINE บนคอมพิวเตอร์/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<LineQrModal isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<LineQrModal isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('copies LINE ID to clipboard when copy button is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<LineQrModal isOpen={true} onClose={vi.fn()} />);

    const copyBtn = screen.getByRole('button', { name: /คัดลอก/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(LINE_ID);
    expect(await screen.findByText('คัดลอกแล้ว')).toBeInTheDocument();
  });
});
