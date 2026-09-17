/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

export interface InvoiceRow {
  tranid: string;
  /** YYYY-MM-DD */
  trandate: string;
  /** YYYY-MM-DD */
  duedate: string;
  amountunpaid: number;
  /** currency symbol/code, e.g. USD */
  currency: string;
}

export interface CustomerResult {
  customerId: number;
  customerName: string;
  status: 'sent' | 'dry-run' | 'skipped' | 'nothing' | 'failed';
  recipients: string[];
  /** field the recipients came from (notification field id, 'email', or '') */
  recipientSource: string;
  /** invoice numbers emailed (or, in dry run, that would have been) */
  invoices: string[];
  /** number of emails sent to this customer (more than one when attachments exceed the size limit) */
  emails: number;
  errors: string[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** 'YYYY-MM-DD' -> 'Sep 9, 2026'; anything else is returned unchanged. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso || '';
}

/** 1234.5 -> '1,234.50' */
export function formatAmount(n: number): string {
  const [whole, frac] = Math.abs(Number(n) || 0).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/** Replaces {{token}} placeholders; unknown tokens are left untouched. */
export function fillTokens(text: string, tokens: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => (key in tokens ? tokens[key] : match));
}

const TD = 'padding:6px 10px;border-bottom:1px solid #ddd;';

export function invoiceTable(rows: InvoiceRow[]): string {
  const currencies = new Set(rows.map((r) => r.currency || ''));
  const total = rows.reduce((sum, r) => sum + (Number(r.amountunpaid) || 0), 0);
  const body = rows
    .map(
      (r) =>
        `<tr><td style="${TD}">${escapeHtml(r.tranid)}</td><td style="${TD}">${formatDate(r.trandate)}</td>` +
        `<td style="${TD}">${formatDate(r.duedate)}</td><td style="${TD}text-align:right;">${escapeHtml(r.currency)} ${formatAmount(r.amountunpaid)}</td></tr>`,
    )
    .join('');
  const totalRow =
    currencies.size === 1
      ? `<tr><td colspan="3" style="${TD}font-weight:bold;">Total</td><td style="${TD}text-align:right;font-weight:bold;">${escapeHtml([...currencies][0])} ${formatAmount(total)}</td></tr>`
      : '';
  return (
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">` +
    `<thead><tr style="background:#f2f2f2;"><th style="${TD}text-align:left;">Invoice #</th><th style="${TD}text-align:left;">Invoice Date</th>` +
    `<th style="${TD}text-align:left;">Due Date</th><th style="${TD}text-align:right;">Amount Unpaid</th></tr></thead>` +
    `<tbody>${body}${totalRow}</tbody></table>`
  );
}

export function digestHtml(results: CustomerResult[], uncaught: string[], dryRun: boolean): { subject: string; body: string } {
  const sent = results.filter((r) => r.status === 'sent' || r.status === 'dry-run');
  const skipped = results.filter((r) => r.status === 'skipped');
  const failed = results.filter((r) => r.status === 'failed' || r.errors.length > 0);
  const nothing = results.filter((r) => r.status === 'nothing' && !r.errors.length).length;
  const emails = sent.reduce((n, r) => n + r.emails, 0);
  const prefix = dryRun ? '[DRY RUN] ' : '';

  const section = (title: string, rows: string[]) =>
    `<h3 style="margin:18px 0 6px;">${title} (${rows.length})</h3>` + (rows.length ? `<ul style="margin:0;">${rows.join('')}</ul>` : '<p style="margin:0;color:#777;">None</p>');
  const li = (s: string) => `<li>${s}</li>`;
  const name = (r: CustomerResult) => `<b>${escapeHtml(r.customerName)}</b> (id ${r.customerId})`;

  const body =
    `<div style="font-family:Arial,sans-serif;font-size:13px;">` +
    `<p>${prefix}AR Invoice Sender run summary: ${sent.length} customer(s) ${dryRun ? 'would be ' : ''}emailed (${emails} email(s)), ` +
    `${skipped.length} skipped for missing email address, ${failed.length + uncaught.length} with errors, ${nothing} with nothing due.</p>` +
    section(dryRun ? 'Would send' : 'Sent', sent.map((r) => li(`${name(r)} &rarr; ${escapeHtml(r.recipients.join(', '))}${r.recipientSource === 'email' ? ' (customer email field)' : ''}: ${escapeHtml(r.invoices.join(', '))}${r.emails > 1 ? ` in ${r.emails} emails` : ''}`))) +
    section('Skipped: no valid email address (notification field and customer email both empty or invalid)', skipped.map((r) => li(name(r)))) +
    section('Errors', [...failed.map((r) => li(`${name(r)}: ${escapeHtml(r.errors.join(' | '))}`)), ...uncaught.map((u) => li(escapeHtml(u)))]) +
    `</div>`;

  return {
    subject: `${prefix}AR Invoice Sender: ${sent.length} sent, ${skipped.length} skipped, ${failed.length + uncaught.length} errors`,
    body,
  };
}
