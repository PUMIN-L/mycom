# UI Implementation Standards

When implementing UI features and pages, strictly follow these standards to ensure a consistent and premium user experience:

## 1. Table Loading States (Skeleton Loaders)
Never use plain text like "กำลังโหลด..." (Loading...) for table loading states. Always implement a pulsing Skeleton loader (`animate-pulse`) that mimics the structure of the data rows.
- Use `Array.from({ length: 3 }).map(...)` (or 5) to generate multiple skeleton rows.
- Use rounded gray blocks for text (`bg-gray-200 rounded`) with varying widths (e.g., `w-24`, `w-48`) to look natural.

## 2. Dropdown Selects
Never use native OS `<select>` elements (`<select> <option>...</option> </select>`) for primary forms or modals, as they look inconsistent across devices (especially dark mode/light mode conflicts where they might appear black).
- **Always** use the custom `SearchableDropdown` component (`app/components/SearchableDropdown.tsx`).
- It supports search and provides a beautiful, consistent UI across all platforms.
- **Styling**: Ensure the dropdown button is styled with a nice white background (e.g., `buttonClassName="bg-white border-gray-200"` or similar) to match the light mode theme of the app perfectly.

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

## 5. Multi-Select Checkboxes (Long Lists)
When displaying a large list of multiple selectable items (like Suppliers or Categories):
- **Do NOT** use a massive grid of checkboxes which takes up vertical space and looks cluttered.
- **Always** use the custom `MultiSelectDropdown` component (`app/components/MultiSelectDropdown.tsx`).
- It renders a clean searchable dropdown and displays selected items as inline tags (chips).

## 6. Drag & Drop Pagination Workarounds
When implementing sortable lists (Drag & Drop) on pages that have **Pagination**:
- Drag and Drop can only reorder items visible on the *current page*.
- To allow users to move items across different pages, you **MUST** provide a "Manual Input Sort" feature.
- Example: In table views, provide a number input field next to the drag handle that allows the user to type the destination index, complete with ✅/❌ Confirm/Cancel buttons for state safety.
