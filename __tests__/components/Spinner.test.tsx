import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Spinner from '@/app/components/Spinner';

describe('Spinner', () => {
  it('renders correctly with default props', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('animate-spin h-5 w-5');
  });

  it('accepts and applies a custom className', () => {
    const { container } = render(<Spinner className="h-10 w-10 text-red-500" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('animate-spin h-10 w-10 text-red-500');
  });
});
