import { describe, it, expect } from "vitest";
import { errorMessageOf, SESSION_EXPIRED_MESSAGE } from "@/app/lib/apiErrorMessage";

const res = (status: number, body: unknown) =>
  ({
    status,
    ok: status < 400,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  }) as unknown as Response;

describe("errorMessageOf", () => {
  it("says the session expired on a 401, whatever the body says", async () => {
    expect(await errorMessageOf(res(401, { error: "Unauthorized" }), "x")).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("says what the route said, trimmed", async () => {
    expect(await errorMessageOf(res(400, { error: "  ลบลูกค้ารายนี้ไม่ได้  " }), "fallback")).toBe("ลบลูกค้ารายนี้ไม่ได้");
  });

  it("falls back when the body has no message, a blank one, or is not JSON", async () => {
    expect(await errorMessageOf(res(500, {}), "fallback")).toBe("fallback");
    expect(await errorMessageOf(res(500, { error: "   " }), "fallback")).toBe("fallback");
    expect(await errorMessageOf(res(500, { error: 42 }), "fallback")).toBe("fallback");
    expect(await errorMessageOf(res(502, null), "fallback")).toBe("fallback");
    expect(await errorMessageOf(res(502, new SyntaxError("Unexpected token <")), "fallback")).toBe("fallback");
  });
});
