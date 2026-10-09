/**
 * The site is Thai until the visitor picks another language — never guessed
 * from the browser. Googlebot renders as an en-US browser, so guessing turned
 * every page it indexed English after hydration, under a Thai <html lang>,
 * title and description.
 */
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { LanguageProvider, useLanguage } from "@/app/i18n/LanguageContext";

function Probe() {
  const { lang, setLang } = useLanguage();
  return (
    <>
      <span data-testid="lang">{lang}</span>
      <button onClick={() => setLang("zh")}>zh</button>
    </>
  );
}

const shown = () => screen.getByTestId("lang").textContent;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("LanguageProvider", () => {
  it("an English browser (Googlebot) with nothing picked gets Thai", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    await act(async () => {
      render(<LanguageProvider><Probe /></LanguageProvider>);
    });
    expect(shown()).toBe("th");
  });

  it("a language the visitor picked is kept, and comes back next time", async () => {
    await act(async () => {
      render(<LanguageProvider><Probe /></LanguageProvider>);
    });
    fireEvent.click(screen.getByText("zh"));
    expect(shown()).toBe("zh");
    cleanup();

    await act(async () => {
      render(<LanguageProvider><Probe /></LanguageProvider>);
    });
    expect(shown()).toBe("zh");
  });

  it("a stored value that is not a language is ignored", async () => {
    localStorage.setItem("idkt-lang", "fr");
    await act(async () => {
      render(<LanguageProvider><Probe /></LanguageProvider>);
    });
    expect(shown()).toBe("th");
  });

  it("blocked storage neither crashes the page nor the switcher", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    await act(async () => {
      render(<LanguageProvider><Probe /></LanguageProvider>);
    });
    expect(shown()).toBe("th");
    fireEvent.click(screen.getByText("zh"));
    expect(shown()).toBe("zh");
  });
});
