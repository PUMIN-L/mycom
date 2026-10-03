import { Fragment } from "react";
import { phoneParts } from "../lib/phone";

// The company phone, exactly as typed, with each number in it a tel: link —
// on a phone, tapping it calls. Anything that is not a number (a separator,
// "/8", a label) stays plain text. Contact page and footer.
export default function PhoneText({ phone, linkClassName }: { phone: string; linkClassName?: string }) {
  return (
    <>
      {phoneParts(phone).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} className={linkClassName}>
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        )
      )}
    </>
  );
}
