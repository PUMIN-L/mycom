import '@testing-library/jest-dom'
import { vi } from 'vitest'

process.env.SESSION_SECRET = 'test-secret-key-12345678901234567890';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn()
    }
  },
  usePathname() {
    return ''
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  notFound: vi.fn(),
  redirect: vi.fn()
}))

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn()
  })),
  headers: vi.fn(() => new Headers())
}))

// Mock server-only
vi.mock('server-only', () => ({}))
