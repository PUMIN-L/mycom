import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  getAllCategories,
  getAllProducts,
  ProductCategory,
  ProductData,
} from "./productStore";

export interface ProductsData {
  categories: ProductCategory[];
  products: ProductData[];
}

const fetchProductsData = async (): Promise<ProductsData> => {
  try {
    const [categories, products] = await Promise.all([
      getAllCategories(),
      getAllProducts(),
    ]);
    return { categories, products };
  } catch (error) {
    console.error("Error fetching products data:", error);
    return { categories: [], products: [] };
  }
};

// Use Next.js Data Cache (unstable_cache) to cache across requests,
// and React.cache to deduplicate within a single request.
export const getProductsData = cache(
  unstable_cache(fetchProductsData, ["products_data"], { tags: ["products"] })
);
