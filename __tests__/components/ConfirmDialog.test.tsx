import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ConfirmDialog from '@/app/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders default text correctly', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        message="Are you sure you want to delete this?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('ยืนยันการลบ')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this?')).toBeInTheDocument();
    expect(screen.getByText('ยกเลิก')).toBeInTheDocument();
    expect(screen.getByText('ลบ')).toBeInTheDocument();
  });

  it('renders custom text correctly', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        title="Custom Title"
        message="Custom Message"
        confirmText="Yes"
        cancelText="No"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Custom Title')).toBeInTheDocument();
    expect(screen.getByText('Custom Message')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(<ConfirmDialog message="Test" onConfirm={onConfirm} onCancel={onCancel} />);
    
    fireEvent.click(screen.getByText('ลบ'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(<ConfirmDialog message="Test" onConfirm={onConfirm} onCancel={onCancel} />);
    
    fireEvent.click(screen.getByText('ยกเลิก'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables buttons and shows loading text when loading is true', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        message="Test"
        onConfirm={onConfirm}
        onCancel={onCancel}
        loading={true}
      />
    );

    const confirmButton = screen.getByRole('button', { name: /กำลังลบ\.\.\./i });
    const cancelButton = screen.getByRole('button', { name: /ยกเลิก/i });

    expect(confirmButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();
  });
});
