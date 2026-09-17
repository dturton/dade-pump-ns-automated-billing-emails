/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[A-Za-z]{2,}$/;

export interface Recipients {
  addresses: string[];
  /** primary = notification field, fallback = standard customer email, none = nothing usable */
  source: 'primary' | 'fallback' | 'none';
  invalid: string[];
}

/** Valid addresses from the notification field; when it has none, from the standard email field. */
export function resolveRecipients(notificationField: string | null | undefined, standardEmail: string | null | undefined): Recipients {
  const primary = parseEmailList(notificationField);
  if (primary.valid.length) return { addresses: primary.valid, source: 'primary', invalid: primary.invalid };
  const fallback = parseEmailList(standardEmail);
  const invalid = [...primary.invalid, ...fallback.invalid];
  if (fallback.valid.length) return { addresses: fallback.valid, source: 'fallback', invalid };
  return { addresses: [], source: 'none', invalid };
}

export interface ParsedEmails {
  valid: string[];
  invalid: string[];
}

/**
 * custentity_billing_email is free text: "a@x.com, b@y.com; Name <c@z.com>".
 * Splits on comma / semicolon / newline (and bare whitespace when no display name),
 * strips "Name <addr>" wrappers, de-duplicates case-insensitively, validates each address.
 */
export function parseEmailList(raw: string | null | undefined): ParsedEmails {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  const parts = String(raw ?? '')
    .split(/[,;\n]+/)
    .flatMap((p) => (p.includes('<') ? [p] : p.trim().split(/\s+/)));

  for (const part of parts) {
    const s = part.trim();
    if (!s) continue;
    const m = /<([^>]*)>/.exec(s);
    const addr = (m ? m[1] : s).trim();
    if (!EMAIL_RE.test(addr)) {
      invalid.push(s);
      continue;
    }
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(addr);
  }
  return { valid, invalid };
}
