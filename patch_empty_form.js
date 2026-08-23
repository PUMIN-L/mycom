const fs = require('fs');
const file = 'app/dashboard/types.ts';
let code = fs.readFileSync(file, 'utf8');

const oldStr = `  warrantyEndDate: "",
  equipmentId: "",
  note: "",
});`;

const newStr = `  warrantyEndDate: "",
  equipmentId: "",
  note: "",
  serialNumbers: [] as string[],
});`;

code = code.replace(oldStr, newStr);
fs.writeFileSync(file, code);
