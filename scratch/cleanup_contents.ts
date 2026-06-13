import { getAllContents, deleteContent } from "../app/lib/contentStore";
import {
  deleteCloudinaryImages,
  collectContentImageUrls,
} from "../app/lib/cloudinaryHelper";

async function run() {
  try {
    console.log("Fetching all contents...");
    const contents = await getAllContents();
    
    // Find unlinked contents (no productId)
    const unlinked = contents.filter(c => !c.productId);
    
    if (unlinked.length === 0) {
      console.log("✅ No unlinked contents found. Database is clean.");
      process.exit(0);
    }
    
    console.log(`Found ${unlinked.length} unlinked contents. Deleting...`);
    
    let deletedCount = 0;
    for (const content of unlinked) {
      console.log(`Deleting content ID: ${content.id}`);
      
      const imageUrls = collectContentImageUrls(content);

      if (imageUrls.length > 0) {
        console.log(`  Deleting ${imageUrls.length} images from Cloudinary...`);
        await deleteCloudinaryImages(imageUrls);
      }
      
      await deleteContent(content.id);
      deletedCount++;
    }
    
    console.log(`✅ Successfully deleted ${deletedCount} unlinked contents and their images.`);
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

run();
