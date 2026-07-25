const fs = require('fs');
const content = fs.readFileSync('__tests__/lib/productStore.test.ts', 'utf8');
const modified = content.replace(
  "const result = await updateProduct('p1', { title_en: 'Updated', isPublished: false });",
  "console.log('BEFORE UPDATE');\ntry {\n  const result = await updateProduct('p1', { title_en: 'Updated', isPublished: false });\n  console.log('RESULT:', result);\n} catch (e) {\n  console.error('ERROR:', e);\n}\nconsole.log('MOCK CALLS:', conn.query.mock.calls.length);"
);
fs.writeFileSync('__tests__/lib/productStore.test.ts', modified);
