const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').forEach(line => {
  const [k, v] = line.split('=');
  if (k && v) process.env[k] = v;
});
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const url = cloudinary.utils.url("samples/mycom/slgy4gwwsbh9dgj6kggz.pdf", {
  sign_url: true,
  type: "upload",
  resource_type: "image"
});

console.log(url);
