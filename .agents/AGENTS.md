# UI Implementation Standards

When implementing UI features and pages, strictly follow these standards to ensure a consistent and premium user experience:

## 1. Table Loading States (Skeleton Loaders)
Never use plain text like "กำลังโหลด..." (Loading...) for table loading states. Always implement a pulsing Skeleton loader (`animate-pulse`) that mimics the structure of the data rows.
- Use `Array.from({ length: 3 }).map(...)` (or 5) to generate multiple skeleton rows.
- Use rounded gray blocks for text (`bg-gray-200 rounded`) with varying widths (e.g., `w-24`, `w-48`) to look natural.

## 2. Dropdown Selects
Never use native OS `<select>` elements (`<select> <option>...</option> </select>`) for primary forms or modals, as they look inconsistent across devices (especially dark mode/light mode conflicts).
- **Always** use the custom `SearchableDropdown` component (`app/components/SearchableDropdown.tsx`).
- It supports search and provides a beautiful, consistent UI across all platforms.

## 3. Clickable Table Rows
When displaying a list of entities (like customers, product specs) that can be edited:
- Make the entire `<tr>` clickable by adding `cursor-pointer`, `hover:bg-gray-50/50`, and moving the click handler to the row.
- Ensure that action buttons inside the row (like "Delete" or "Edit") use `e.stopPropagation()` in their `onClick` handlers so they don't accidentally trigger the row click event.

## 4. Access Control for Admin Pages
The following pages are strictly for admin/management use and **MUST NOT** be accessible without logging in. Always ensure they are protected by `middleware.ts` matchers:
- `/create-content`
- `/documents`
- `/quotation`
- `/quotation/saved`
- `/customers`
- `/product-specs`
- `/settings`
