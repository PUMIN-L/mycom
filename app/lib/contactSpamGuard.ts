// Anti-spam settings for the public contact form, shared by the form
// (components/Contact.tsx) and the route that receives it (api/contact).

/**
 * An input people never see. A bot that fills every field fills this one
 * too, and /api/contact then answers "sent" and drops the submission.
 * Named like a field a bot expects; the form marks it autocomplete="off" so
 * a browser never fills it for a person.
 */
export const CONTACT_HONEYPOT_FIELD = "website";

/**
 * Leads emailed to the admin per hour, across every serverless instance.
 * Past it, leads are still stored (the admin inbox shows them) but not
 * emailed one by one — a flood cannot turn into hundreds of emails. Far above
 * the real enquiries this site gets.
 */
export const CONTACT_EMAIL_CAP_PER_HOUR = 30;
