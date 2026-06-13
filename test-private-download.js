const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v.length) process.env[k] = v.join('=').trim();
});
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const url = cloudinary.utils.private_download_url("samples/mycom/doc_1781332550191_1l0re7psqm3", "pdf", {
  resource_type: "raw"
});

console.log(url);
