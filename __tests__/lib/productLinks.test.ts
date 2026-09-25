// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapContentIdByProduct, contentIdFor, productHref } from "@/app/lib/productLinks";

describe("mapContentIdByProduct", () => {
  const contents = [
    { id: "c-new", productId: "p1" },
    { id: "c-old", productId: "p1" },
    { id: "c-2", productId: "p2" },
    { id: "c-hidden", productId: "p-hidden" },
    { id: "c-free", productId: null },
  ];

  it("maps only the products asked for — a hidden product's content id never leaks", () => {
    expect(mapContentIdByProduct(["p1", "p2"], contents)).toEqual({ p1: "c-new", p2: "c-2" });
  });

  it("keeps the first content per product (contents arrive newest first)", () => {
    expect(mapContentIdByProduct(["p1"], contents).p1).toBe("c-new");
  });

  it("cannot be tricked into writing the prototype by a product id", () => {
    const map = mapContentIdByProduct(["__proto__"], [{ id: "c-x", productId: "__proto__" }]);
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    expect(contentIdFor("__proto__", map)).toBe("c-x");
  });
});

describe("productHref", () => {
  const map = { p1: "c-1" };

  it("links straight to the content page when the product has one", () => {
    expect(productHref("p1", map)).toBe("/showcase/c-1");
  });

  it("falls back to the gateway when it has none, or there is no map", () => {
    expect(productHref("p2", map)).toBe("/showcase/product/p2");
    expect(productHref("p1", undefined)).toBe("/showcase/product/p1");
  });

  it("ignores inherited keys", () => {
    expect(productHref("toString", map)).toBe("/showcase/product/toString");
  });

  it("encodes ids", () => {
    expect(productHref("a b/c", {})).toBe("/showcase/product/a%20b%2Fc");
  });
});
