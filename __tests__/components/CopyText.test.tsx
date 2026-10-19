/**
 * A phone number or e-mail that copies itself when clicked
 * (app/components/CopyText.tsx) — inside rows that open a record on click.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import CopyText from "@/app/components/CopyText";

function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText: vi.fn(writeText) } : undefined,
  });
  return navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> } | undefined;
}

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

describe("CopyText", () => {
  it("shows '-' and no button when there is nothing to copy", () => {
    const { container } = render(<CopyText value="   " />);
    expect(container.textContent).toBe("-");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    render(<CopyText value={null} />);
    render(<CopyText value={undefined} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("copies the trimmed text and says so", async () => {
    const clip = stubClipboard(async () => {});
    const onCopied = vi.fn();
    const onFailed = vi.fn();
    render(<CopyText value=" 0812345678 " onCopied={onCopied} onFailed={onFailed} />);

    const btn = screen.getByRole("button", { name: "คัดลอก 0812345678" });
    expect(btn).toHaveAttribute("title", "คลิกเพื่อคัดลอก");
    expect(btn.textContent).toBe("0812345678");
    fireEvent.click(btn);

    await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    expect(clip!.writeText).toHaveBeenCalledWith("0812345678");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("reports a refused copy", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const onCopied = vi.fn();
    const onFailed = vi.fn();
    render(<CopyText value="a@b.co" onCopied={onCopied} onFailed={onFailed} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("reports a browser with no clipboard (plain http) instead of throwing", async () => {
    stubClipboard(undefined);
    const onFailed = vi.fn();
    render(<CopyText value="a@b.co" onFailed={onFailed} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
  });

  it("works without callbacks", async () => {
    const clip = stubClipboard(async () => {});
    render(<CopyText value="x" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(clip!.writeText).toHaveBeenCalled());
  });

  it("keeps its click and keys from reaching the row around it", async () => {
    stubClipboard(async () => {});
    const rowClick = vi.fn();
    const rowKey = vi.fn();
    render(
      <div onClick={rowClick} onKeyDown={rowKey}>
        <CopyText value="0812345678" className="extra-class" />
      </div>
    );
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("extra-class");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyDown(btn, { key: " " });
    expect(rowClick).not.toHaveBeenCalled();
    expect(rowKey).not.toHaveBeenCalled();
  });

  it("lets every other key through — Esc must still reach a modal's listener", () => {
    const onDocumentKey = vi.fn();
    document.addEventListener("keydown", onDocumentKey);
    try {
      render(<CopyText value="0812345678" />);
      fireEvent.keyDown(screen.getByRole("button"), { key: "Escape" });
      expect(onDocumentKey).toHaveBeenCalledTimes(1);
      expect(onDocumentKey.mock.calls[0][0].key).toBe("Escape");
    } finally {
      document.removeEventListener("keydown", onDocumentKey);
    }
  });
});
