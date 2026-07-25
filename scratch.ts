import { getAllProducts } from './app/lib/productStore';
async function run() {
  const products = await getAllProducts();
  const p = products.find(p => p.title_th?.includes('GM-1') || p.title_en?.includes('GM-1'));
  console.log(p?.title_th, p?.image);
}
run();
