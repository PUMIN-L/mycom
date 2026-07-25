const fs = require('fs');
const mysql = require('mysql2/promise');
const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].replace(/"/g, '');
async function run() {
  const conn = await mysql.createConnection(dbUrl);
  const [rows] = await conn.query("SELECT id, title_th, title_en, image FROM products WHERE title_en LIKE '%GM-1%' OR title_th LIKE '%GM-1%'");
  console.log(JSON.stringify(rows, null, 2));
  conn.end();
}
run();
