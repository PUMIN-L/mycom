/**
 * hardDeleteProduct destroys two things — the product row and every showcase
 * content linked to it — and returns the Cloudinary URLs left unreferenced so
 * the caller can offer to clean them up. There is no transaction here, so the
 * ORDER of those deletes is the only thing deciding what a lost race leaves
 * behind.
 *
 * The product row is claimed FIRST: `DELETE ... WHERE id = ?` reporting
 * affectedRows > 0 is atomic, so of two concurrent hard-deletes exactly one
 * proceeds and the loser destroys nothing. When the content loop ran first
 * instead, the loser had already deleted the contents by the time
 * deleteProduct returned false — and the `null` returned then (which the API
 * route maps to a 500 "failed to hard delete") threw away the collected image
 * list with it, stranding those images in Cloudinary with nothing left
 * referencing them and no way for anyone to find them again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getProduct = vi.fn();
const deleteProduct = vi.fn();
const getContentsByProductId = vi.fn();
const deleteContent = vi.fn();
const collectContentImageUrls = vi.fn();

vi.mock("@/app/lib/productStore", () => ({
  getProduct: (...args: unknown[]) => getProduct(...args),
  deleteProduct: (...args: unknown[]) => deleteProduct(...args),
}));
vi.mock("@/app/lib/contentStore", () => ({
  getContentsByProductId: (...args: unknown[]) => getContentsByProductId(...args),
  deleteContent: (...args: unknown[]) => deleteContent(...args),
}));
vi.mock("@/app/lib/cloudinaryHelper", () => ({
  collectContentImageUrls: (...args: unknown[]) => collectContentImageUrls(...args),
}));

import { hardDeleteProduct } from "@/app/lib/productDeleter";

const PRODUCT_IMAGE = "https://res.cloudinary.com/demo/image/upload/product.jpg";
const CONTENT_IMAGE = "https://res.cloudinary.com/demo/image/upload/block.jpg";
const FOREIGN_IMAGE = "https://images.example.com/not-ours.jpg";

beforeEach(() => {
  vi.clearAllMocks();
  collectContentImageUrls.mockReturnValue([]);
  getContentsByProductId.mockResolvedValue([]);
  deleteContent.mockResolvedValue(true);
});

describe("hardDeleteProduct", () => {
  it("returns null without touching anything when the product does not exist", async () => {
    getProduct.mockResolvedValue(undefined);

    expect(await hardDeleteProduct("gone")).toBeNull();
    expect(deleteProduct).not.toHaveBeenCalled();
    expect(deleteContent).not.toHaveBeenCalled();
  });

  it("deletes no content when it loses the race for the product row", async () => {
    // The row disappeared between the read and the claim — another hard-delete
    // got there first. affectedRows is 0, so this caller must bow out having
    // destroyed nothing: the winner owns the contents and their images.
    getProduct.mockResolvedValue({ id: "p1", image: PRODUCT_IMAGE });
    deleteProduct.mockResolvedValue(false);
    getContentsByProductId.mockResolvedValue([{ id: "c1" }]);
    collectContentImageUrls.mockReturnValue([CONTENT_IMAGE]);

    expect(await hardDeleteProduct("p1")).toBeNull();
    expect(deleteContent).not.toHaveBeenCalled();
  });

  it("deletes the product and every linked content, reporting their Cloudinary images", async () => {
    getProduct.mockResolvedValue({ id: "p1", image: PRODUCT_IMAGE });
    deleteProduct.mockResolvedValue(true);
    getContentsByProductId.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    collectContentImageUrls
      .mockReturnValueOnce([CONTENT_IMAGE])
      .mockReturnValueOnce([FOREIGN_IMAGE]);

    const orphaned = await hardDeleteProduct("p1");

    expect(deleteContent).toHaveBeenCalledTimes(2);
    expect(deleteContent).toHaveBeenCalledWith("c1");
    expect(deleteContent).toHaveBeenCalledWith("c2");
    // Only images we actually host are reported — a URL on someone else's
    // domain is not ours to delete.
    expect(orphaned).toEqual(
      expect.arrayContaining([PRODUCT_IMAGE, CONTENT_IMAGE])
    );
    expect(orphaned).not.toContain(FOREIGN_IMAGE);
    expect(orphaned).toHaveLength(2);
  });

  it("reports no image for a product that has none", async () => {
    getProduct.mockResolvedValue({ id: "p1", image: "" });
    deleteProduct.mockResolvedValue(true);

    expect(await hardDeleteProduct("p1")).toEqual([]);
  });
});
