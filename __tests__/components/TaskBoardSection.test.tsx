/**
 * TaskBoardSection — the "customer"/"equipment" chip rendering specifically
 * (spec: open-task-chip-targets-in-place). Everything else about this
 * component (loading, topic chips, complete/reopen/delete) is exercised
 * indirectly through the page tests; this file isolates just the chip
 * click-target decision, which is the one thing this change touches.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import TaskBoardSection from "@/app/components/TaskBoardSection";
import type { LinkTargetIndex } from "@/app/lib/taskBoard";

const TOPIC = {
  id: 1,
  name: "อื่นๆ",
  icon: "📌",
  color: "slate",
  sortOrder: 0,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const TASK = {
  id: "t1",
  topicId: 1,
  title: "งานทดสอบ",
  detail: null,
  dueDate: null,
  status: "pending" as const,
  completedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  topicName: "อื่นๆ",
  topicIcon: "📌",
  topicColor: "slate",
  links: [
    { taskId: "t1", targetType: "customer" as const, targetId: "cus-1", label: "คุณสมชาย", createdAt: "" },
    { taskId: "t1", targetType: "equipment" as const, targetId: "eq-1", label: "เครื่องชั่ง A", createdAt: "" },
    { taskId: "t1", targetType: "quotation" as const, targetId: "q-1", label: "QT-1", createdAt: "" },
    { taskId: "t1", targetType: "document" as const, targetId: "d-1", label: "เอกสาร A", createdAt: "" },
  ],
};

function stubTasksFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/tasks")) {
      return { ok: true, status: 200, json: async () => [TASK] } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TaskBoardSection — chip click targets", () => {
  it("customer/equipment chips call onOpenCustomer/onOpenEquipment when given, instead of navigating", async () => {
    stubTasksFetch();
    const onOpenCustomer = vi.fn();
    const onOpenEquipment = vi.fn();
    render(
      <TaskBoardSection
        topics={[TOPIC]}
        onCreateTask={vi.fn()}
        onEditTask={vi.fn()}
        onOpenCustomer={onOpenCustomer}
        onOpenEquipment={onOpenEquipment}
      />
    );

    const customerChip = await screen.findByRole("button", { name: /คุณสมชาย/ });
    fireEvent.click(customerChip);
    expect(onOpenCustomer).toHaveBeenCalledWith("cus-1");
    expect(onOpenCustomer).toHaveBeenCalledTimes(1);

    const equipmentChip = screen.getByRole("button", { name: /เครื่องชั่ง A/ });
    fireEvent.click(equipmentChip);
    expect(onOpenEquipment).toHaveBeenCalledWith("eq-1");

    // Neither handler was invoked with the other kind's id.
    expect(onOpenCustomer).not.toHaveBeenCalledWith("eq-1");
    expect(onOpenEquipment).not.toHaveBeenCalledWith("cus-1");
  });

  it("quotation/document chips stay plain navigable links regardless of the new props", async () => {
    stubTasksFetch();
    render(
      <TaskBoardSection
        topics={[TOPIC]}
        onCreateTask={vi.fn()}
        onEditTask={vi.fn()}
        onOpenCustomer={vi.fn()}
        onOpenEquipment={vi.fn()}
      />
    );

    const quotationChip = await screen.findByRole("link", { name: /QT-1/ });
    expect(quotationChip).toHaveAttribute("href", "/quotation?id=q-1&view=1");
    const documentChip = screen.getByRole("link", { name: /เอกสาร A/ });
    expect(documentChip).toHaveAttribute("href", "/document/d-1");
  });

  it("falls back to a plain <Link> for customer/equipment when no handler is given — never a dead button", async () => {
    stubTasksFetch();
    render(<TaskBoardSection topics={[TOPIC]} onCreateTask={vi.fn()} onEditTask={vi.fn()} />);

    const customerChip = await screen.findByRole("link", { name: /คุณสมชาย/ });
    expect(customerChip).toHaveAttribute("href", "/customers?tab=customers&customerId=cus-1");
    const equipmentChip = screen.getByRole("link", { name: /เครื่องชั่ง A/ });
    expect(equipmentChip).toHaveAttribute("href", "/customers?tab=equipments&equipmentId=eq-1");
  });

  it("a chip whose target is confirmed DEAD stays an inert span, even with onOpenCustomer set", async () => {
    stubTasksFetch();
    const onOpenCustomer = vi.fn();
    // customer bucket PRESENT (checked) but empty ⇒ cus-1 was looked up and
    // not found ⇒ dead. Contrast with omitting the key entirely, which means
    // "not checked" and keeps the chip clickable (see the no-index case
    // covered by the plain click test above).
    const linkTargetIndex: LinkTargetIndex = { customer: {} };
    render(
      <TaskBoardSection
        topics={[TOPIC]}
        onCreateTask={vi.fn()}
        onEditTask={vi.fn()}
        onOpenCustomer={onOpenCustomer}
        linkTargetIndex={linkTargetIndex}
      />
    );

    await screen.findByText("งานทดสอบ");
    expect(screen.queryByRole("button", { name: /คุณสมชาย/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /คุณสมชาย/ })).not.toBeInTheDocument();
    const deadChip = screen.getByText(/คุณสมชาย.*ถูกลบแล้ว/);
    expect(deadChip.closest("[aria-disabled]")).toBeInTheDocument();
    fireEvent.click(deadChip);
    expect(onOpenCustomer).not.toHaveBeenCalled();
  });
});
