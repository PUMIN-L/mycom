const fs = require('fs');

// Fix 1: equipmentId null bug
const storeFile = 'app/lib/salesDashboardStore.ts';
let storeCode = fs.readFileSync(storeFile, 'utf8');

const oldEquipmentId = `    equipmentId: data.equipmentId
      ? sanitizePlainText(data.equipmentId).substring(0, 36)
      : null,`;
const newEquipmentId = `    equipmentId: data.equipmentId
      ? sanitizePlainText(data.equipmentId).substring(0, 36)
      : "",`;

storeCode = storeCode.replace(oldEquipmentId, newEquipmentId);
fs.writeFileSync(storeFile, storeCode);

// Fix 2: PUT syncEquipments fk error bug
const putFile = 'app/api/admin/sales/[id]/route.ts';
let putCode = fs.readFileSync(putFile, 'utf8');

const oldSync = `    // Sync equipments if sale type is equipment
    if (body.saleType === "equipment" && Array.isArray(body.serialNumbers)) {`;
const newSync = `    // Sync equipments if sale type is equipment
    if (body.saleType === "equipment" && body.customerId && body.customerId.trim() && Array.isArray(body.serialNumbers)) {`;

putCode = putCode.replace(oldSync, newSync);
fs.writeFileSync(putFile, putCode);
