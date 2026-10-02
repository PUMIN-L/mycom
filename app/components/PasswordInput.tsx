"use client";
import { useState } from "react";

// A password field with an eye button that shows what was typed. Used by the
// password forms (/settings → เปลี่ยนรหัสผ่าน, /forgot-password): a wrong
// "current password" is far easier to spot when it can be read, and a
// browser's autofill can put an old saved password there unseen.
//
// `inputClassName` styles the field itself (the light settings form and the
// dark public page differ); the right padding for the button is added here.

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  inputClassName: string;
  /** Tone of the eye button: on a light or on a dark background. */
  tone?: "light" | "dark";
  required?: boolean;
};

export default function PasswordInput({ id, value, onChange, autoComplete, inputClassName, tone = "light", required }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        // Never let a mobile keyboard "fix" a password while it is visible.
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={`${inputClassName} pr-12`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
        aria-pressed={visible}
        aria-controls={id}
        className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 transition ${
          tone === "dark" ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"
        }`}
      >
        {visible ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}
