/**
 * `useTaskTopics.ts` — the module-level cache shared by both quick-create
 * buttons (customer + equipment). Not a React hook (nothing here needs
 * reactive re-rendering), so it is tested directly as a module, the same way
 * `ensureTaskLinkTargets`/`__resetTaskLinkTargets` are exercised through
 * `TaskFormModal.test.tsx` rather than in isolation — except this one has no
 * component wrapping it at all, so a plain unit test is the honest one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureTaskTopicsLoaded, __resetTaskTopics } from "@/app/components/useTaskTopics";

const TOPIC = {
  id: 1,
  name: "โทรลูกค้า",
  icon: "📞",
  color: "blue",
  sortOrder: 0,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockFetch(response: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  __resetTaskTopics();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ensureTaskTopicsLoaded", () => {
  it("fetches on first call and returns the topics", async () => {
    const fetchMock = mockFetch([TOPIC]);
    const topics = await ensureTaskTopicsLoaded();
    expect(topics).toEqual([TOPIC]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/task-topics");
  });

  it("never asks for hidden topics — no includeHidden param", async () => {
    const fetchMock = mockFetch([TOPIC]);
    await ensureTaskTopicsLoaded();
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("includeHidden");
  });

  it("a second call after success is served from cache — no second request", async () => {
    const fetchMock = mockFetch([TOPIC]);
    await ensureTaskTopicsLoaded();
    const topics2 = await ensureTaskTopicsLoaded();
    expect(topics2).toEqual([TOPIC]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls before the first resolves collapse onto ONE request", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);

    const callA = ensureTaskTopicsLoaded();
    const callB = ensureTaskTopicsLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, status: 200, json: async () => [TOPIC] });
    const [a, b] = await Promise.all([callA, callB]);
    expect(a).toEqual([TOPIC]);
    expect(b).toEqual([TOPIC]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a failed load resolves to null and is retried on the very next call — never cached as a permanent failure", async () => {
    mockFetch({ error: "boom" }, false);
    const first = await ensureTaskTopicsLoaded();
    expect(first).toBeNull();

    const fetchMock2 = mockFetch([TOPIC]);
    const second = await ensureTaskTopicsLoaded();
    expect(second).toEqual([TOPIC]);
    expect(fetchMock2).toHaveBeenCalledTimes(1);
  });

  it("a network exception is treated the same as a failed response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await ensureTaskTopicsLoaded();
    expect(result).toBeNull();
  });

  it("caches an empty list too — a genuinely topic-less system is not re-fetched forever", async () => {
    const fetchMock = mockFetch([]);
    const first = await ensureTaskTopicsLoaded();
    expect(first).toEqual([]);
    const second = await ensureTaskTopicsLoaded();
    expect(second).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the cache survives across separate 'mounts' — it is module-level, not per-component", async () => {
    // Simulates: /customers loads topics, admin navigates to /crm/alerts and
    // opens EquipmentDetailsModal — a completely different component, same
    // module instance within the same browser session.
    const fetchMock = mockFetch([TOPIC]);
    await ensureTaskTopicsLoaded(); // "customer button" call site
    const fromEquipmentButton = await ensureTaskTopicsLoaded(); // "equipment button" call site
    expect(fromEquipmentButton).toEqual([TOPIC]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("__resetTaskTopics clears the cache so the next call fetches again", async () => {
    const fetchMock = mockFetch([TOPIC]);
    await ensureTaskTopicsLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    __resetTaskTopics();

    const fetchMock2 = mockFetch([TOPIC]);
    await ensureTaskTopicsLoaded();
    expect(fetchMock2).toHaveBeenCalledTimes(1);
  });
});
