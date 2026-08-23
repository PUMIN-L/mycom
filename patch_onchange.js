const fs = require('fs');
const file = 'app/dashboard/page.tsx';
let code = fs.readFileSync(file, 'utf8');

const oldStr = `const newSn = [...form.serialNumbers];`;
const newStr = `const newSn = [...(form.serialNumbers || [])];`;

code = code.replace(oldStr, newStr);
fs.writeFileSync(file, code);
