/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Read-only preview: every invoice the AR Invoice Sender's query returns, with the
 * cadence verdict for today. Sends nothing and changes nothing.
 */

import { EntryPoints } from 'N/types';
import * as serverWidget from 'N/ui/serverWidget';
import * as url from 'N/url';
import { explainSend, SendVerdict } from './lib/cadence';
import { resolveRecipients } from './lib/emailAddress';
import { escapeHtml, formatAmount, formatDate } from './lib/html';
import { forEachOpenInvoice, OpenInvoice, openInvoicesSql } from './lib/openInvoices';

/** ponytail: hard cap on rows rendered into one page; use the filters beyond this. */
const MAX_ROWS = 2000;

interface PreviewRow {
  inv: OpenInvoice;
  recipients: string[];
  /** 'primary' = notification field, 'fallback' = customer email field */
  source: string;
  verdict: SendVerdict;
}

export const onRequest: EntryPoints.Suitelet.onRequest = (ctx) => {
  const p = ctx.request.parameters as Record<string, string | undefined>;
  const filters = {
    customerId: Number(p.custpage_customer) || undefined,
    subsidiaryId: Number(p.custpage_subsidiary) || undefined,
  };
  const sendDaily = p.custpage_daily === 'T';
  const onlySending = p.custpage_only_sending === 'T';

  const form = serverWidget.createForm({ title: 'AR Invoice Sender - Preview' });
  form.addFieldGroup({ id: 'custpage_filters', label: 'Filters' });
  const fld = (id: string, type: serverWidget.FieldType, label: string, source?: string) =>
    form.addField({ id, type, label, source, container: 'custpage_filters' });
  fld('custpage_customer', serverWidget.FieldType.SELECT, 'Customer', 'customer').defaultValue = filters.customerId ? String(filters.customerId) : '';
  fld('custpage_subsidiary', serverWidget.FieldType.SELECT, 'Subsidiary', 'subsidiary').defaultValue = filters.subsidiaryId ? String(filters.subsidiaryId) : '';
  fld('custpage_daily', serverWidget.FieldType.CHECKBOX, 'Evaluate as Send Daily').defaultValue = sendDaily ? 'T' : 'F';
  fld('custpage_only_sending', serverWidget.FieldType.CHECKBOX, 'Only invoices sending today').defaultValue = onlySending ? 'T' : 'F';
  form.addSubmitButton({ label: 'Refresh' });

  const rows: PreviewRow[] = [];
  let truncated = false;
  forEachOpenInvoice(filters, (inv) => {
    const rec = resolveRecipients(inv.notifyemail, inv.customeremail);
    const recipients = rec.addresses;
    const verdict = recipients.length
      ? explainSend({ daysOverdue: Number(inv.daysoverdue), lastSentDaysOverdue: inv.lastsentdaysoverdue == null ? null : Number(inv.lastsentdaysoverdue) }, sendDaily)
      : { send: false, reason: 'customer skipped: no valid email address' };
    if (onlySending && !verdict.send) return;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      return false;
    }
    rows.push({ inv, recipients, source: rec.source, verdict });
  });

  const results = form.addField({ id: 'custpage_results', type: serverWidget.FieldType.INLINEHTML, label: 'Results' });
  results.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW });
  results.defaultValue = renderResults(rows, truncated, sendDaily) + renderSql(filters);
  ctx.response.writePage(form);
};

const TD = 'padding:5px 8px;border-bottom:1px solid #ddd;white-space:nowrap;';

/** The exact SuiteQL this page ran, with the bind values inlined so it can be pasted into a SuiteQL tool. */
function renderSql(filters: Parameters<typeof openInvoicesSql>[0]): string {
  const sql = openInvoicesSql(filters);
  let i = 0;
  const inlined = sql.query.replace(/\?/g, () => String(sql.params[i++]));
  return `<details style="margin-top:12px;font-family:Arial,sans-serif;font-size:12px;"><summary>SuiteQL used for this preview</summary><pre>${escapeHtml(inlined)}</pre></details>`;
}

function renderResults(rows: PreviewRow[], truncated: boolean, sendDaily: boolean): string {
  const customers = new Set(rows.map((r) => r.inv.customerid));
  const sending = rows.filter((r) => r.verdict.send);
  const sendingCustomers = new Set(sending.map((r) => r.inv.customerid));
  const noEmail = new Set(rows.filter((r) => !r.recipients.length).map((r) => r.inv.customerid));
  const unpaid = new Map<string, number>();
  for (const r of rows) unpaid.set(r.inv.currency || '', (unpaid.get(r.inv.currency || '') || 0) + (Number(r.inv.amountunpaid) || 0));
  const totals = [...unpaid.entries()].map(([cur, n]) => `${escapeHtml(cur)} ${formatAmount(n)}`).join('; ');

  const link = (recordType: string, recordId: number, text: string) =>
    `<a href="${escapeHtml(url.resolveRecord({ recordType, recordId, isEditMode: false }))}" target="_blank">${escapeHtml(text)}</a>`;

  const body = rows
    .map((r) => {
      const bg = !r.recipients.length ? '#fde8e8' : r.verdict.send ? '#e6f4ea' : '';
      const tr = `<tr style="background:${bg};">`;
      return (
        tr +
        `<td style="${TD}">${link('customer', r.inv.customerid, r.inv.customername)}</td>` +
        `<td style="${TD}${r.recipients.length ? '' : 'color:#a00;'}">${
          r.recipients.length
            ? escapeHtml(r.recipients.join(', ')) + (r.source === 'fallback' ? ' <i>(customer email field)</i>' : '')
            : 'none valid: ' + escapeHtml([r.inv.notifyemail, r.inv.customeremail].filter(Boolean).join(' / ') || '(both empty)')
        }</td>` +
        `<td style="${TD}">${escapeHtml(r.inv.subsidiaryname || '')}</td>` +
        `<td style="${TD}">${link('invoice', r.inv.invoiceid, r.inv.tranid)}</td>` +
        `<td style="${TD}">${formatDate(r.inv.trandate)}</td>` +
        `<td style="${TD}">${formatDate(r.inv.duedate)}</td>` +
        `<td style="${TD}text-align:right;">${Number(r.inv.daysoverdue)}</td>` +
        `<td style="${TD}text-align:right;">${escapeHtml(r.inv.currency)} ${formatAmount(Number(r.inv.amountunpaid))}</td>` +
        `<td style="${TD}">${r.inv.lastsent ? formatDate(r.inv.lastsent) : 'never'}</td>` +
        `<td style="${TD}text-align:right;">${Number(r.inv.sendcount) || 0}</td>` +
        `<td style="${TD}"><b>${r.verdict.send ? 'Yes' : 'No'}</b> - ${escapeHtml(r.verdict.reason)}</td>` +
        `</tr>`
      );
    })
    .join('');

  const th = (label: string, right = false) => `<th style="${TD}text-align:${right ? 'right' : 'left'};">${label}</th>`;
  return (
    `<div style="font-family:Arial,sans-serif;font-size:12px;margin-top:10px;">` +
    `<p><b>${rows.length}</b> open invoice(s) for <b>${customers.size}</b> customer(s) match the AR Invoice Sender query` +
    `${sendDaily ? ' (evaluated as Send Daily)' : ''}. ` +
    `Sending today: <b>${sending.length}</b> invoice(s) to <b>${sendingCustomers.size}</b> customer(s). ` +
    `Customers with no valid email address: <b>${noEmail.size}</b>. Unpaid total: ${totals || '0.00'}.</p>` +
    (truncated ? `<p style="color:#a00;">Only the first ${MAX_ROWS} rows are shown. Narrow the filters to see the rest.</p>` : '') +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    `<thead><tr style="background:#f2f2f2;">${th('Customer')}${th('Recipients')}${th('Subsidiary')}${th('Invoice #')}${th('Invoice Date')}${th('Due Date')}` +
    `${th('Days Overdue', true)}${th('Amount Unpaid', true)}${th('Last Sent')}${th('Sent Count', true)}${th('Sends Today?')}</tr></thead>` +
    `<tbody>${body}</tbody></table></div>`
  );
}
