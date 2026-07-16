import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Toast from '@/app/components/Toast';

describe('Toast', () => {
  it('renders a success message correctly', () => {
    render(<Toast message="Data saved successfully" type="success" />);
    const toast = screen.getByText('✅ Data saved successfully');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveClass('bg-green-500');
  });

  it('renders an error message correctly', () => {
    render(<Toast message="Failed to save" type="error" />);
    const toast = screen.getByText('❌ Failed to save');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveClass('bg-red-500');
  });
});
