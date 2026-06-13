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

async function run() {
  const result = await cloudinary.uploader.upload(
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    {
      folder: "samples/mycom",
      resource_type: "raw",
      type: "authenticated"
    }
  );
  console.log("AUTH URL:", result.secure_url);
  console.log("PUBLIC ID:", result.public_id);
  
  const signed = cloudinary.utils.url(result.public_id, {
    sign_url: true,
    type: "authenticated",
    resource_type: "raw"
  });
  console.log("SIGNED URL:", signed);
}
run();
