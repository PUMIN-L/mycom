import { v2 as cloudinary } from "cloudinary";
import { getAllProducts } from "../app/lib/productStore";
import { getAllContents } from "../app/lib/contentStore";
import { extractPublicId, collectContentImageUrls } from "../app/lib/cloudinaryHelper";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function run() {
  try {
    console.log("Fetching active images from Database...");
    
    // 1. Get Product Images
    const products = await getAllProducts();
    const productImages = products
      .map(p => p.image)
      .filter(img => img && img.includes("cloudinary.com"));
      
    // 2. Get Content Images (every block carrying an imageUrl — incl. text-image,
    //    otherwise those in-use images would be misclassified as orphans below).
    const contents = await getAllContents();
    const contentImages: string[] = contents
      .flatMap(collectContentImageUrls)
      .filter(img => img.includes("cloudinary.com"));
    
    // 3. Collect active public IDs
    const activePublicIds = new Set<string>();
    [...productImages, ...contentImages].forEach(url => {
      const pid = extractPublicId(url);
      if (pid) activePublicIds.add(pid);
    });
    
    console.log(`Found ${activePublicIds.size} active Cloudinary images in Database.`);
    
    // 4. Fetch images from Cloudinary
    console.log("Fetching all images from Cloudinary folder 'samples/mycom'...");
    
    let allCloudinaryImages: any[] = [];
    let nextCursor = null;
    
    do {
      const result: any = await cloudinary.api.resources({
        type: "upload",
        prefix: "samples/mycom/",
        max_results: 500,
        next_cursor: nextCursor,
      });
      
      allCloudinaryImages = allCloudinaryImages.concat(result.resources);
      nextCursor = result.next_cursor;
    } while (nextCursor);
    
    console.log(`Found ${allCloudinaryImages.length} images total in Cloudinary folder 'samples/mycom'.`);
    
    // 5. Find orphaned images
    const orphanedImages = allCloudinaryImages.filter(img => !activePublicIds.has(img.public_id));
    
    if (orphanedImages.length === 0) {
      console.log("✅ No orphaned images found! Cloudinary storage is clean.");
      process.exit(0);
    }
    
    console.log(`Found ${orphanedImages.length} orphaned images. Deleting...`);
    
    let deletedCount = 0;
    for (const img of orphanedImages) {
      console.log(`Deleting: ${img.public_id}`);
      await cloudinary.uploader.destroy(img.public_id);
      deletedCount++;
    }
    
    console.log(`✅ Successfully deleted ${deletedCount} orphaned images from Cloudinary.`);
    process.exit(0);
    
  } catch (error) {
    console.error("Error during cleanup:", error);
    process.exit(1);
  }
}

run();
