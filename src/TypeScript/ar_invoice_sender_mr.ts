/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Emails open customer invoices (as PDF attachments) on a daily cadence.
 * getInputData: SuiteQL for open invoices (lib/openInvoices), grouped by customer.
 * reduce (per customer): cadence filter -> render PDFs -> one email (split only if > 15 MB) -> stamp invoices.
 * summarize: internal digest email.
 */

import { EntryPoints } from 'N/types';
import * as email from 'N/email';
import type { File } from 'N/file';
import * as log from 'N/log';
import * as record from 'N/record';
import * as render from 'N/render';
import * as runtime from 'N/runtime';
import { MAX_BATCH_BYTES, splitBySize } from './lib/batching';
import { shouldSend } from './lib/cadence';
import { resolveRecipients } from './lib/emailAddress';
import { CustomerResult, digestHtml, fillTokens, invoiceTable } from './lib/html';
import { forEachOpenInvoice, NOTIFY_EMAIL_FIELD, OpenInvoice } from './lib/openInvoices';
import { getParams, PARAM, Params, senderFor } from './lib/params';

interface Rendered {
  inv: OpenInvoice;
  file: File;
  bytes: number;
}

/** email.send allows at most 10 recipients (to + cc + bcc). */
const MAX_RECIPIENTS = 10;
// Governance (units): render.transaction 10, record.submitFields 10, render.mergeEmail 10, email.send 20.
const RENDER_UNITS = 10;
const STAMP_UNITS = 10;
/** mergeEmail + a few email.send calls + margin, reserved before every render. */
const FINISH_UNITS = 200;

export const getInputData: EntryPoints.MapReduce.getInputData = () => {
  const params = getParams(); // fail fast on bad configuration before touching any data
  const byCustomer: Record<string, OpenInvoice[]> = {};
  let rows = 0;
  if (params.customerId) log.audit('getInputData', `Customer parameter set: only customer ${params.customerId} is processed`);
  forEachOpenInvoice({ customerId: params.customerId }, (row) => {
    const key = String(row.customerid);
    (byCustomer[key] || (byCustomer[key] = [])).push(row);
    rows++;
  });
  log.audit('getInputData', `${rows} open invoice(s) across ${Object.keys(byCustomer).length} customer(s)`);
  // ponytail: the whole result set is grouped in memory here (no map stage). Fine up to tens of
  // thousands of open invoices; beyond that return { type: 'suiteql' } and re-key in a map stage.
  return byCustomer;
};

export const reduce: EntryPoints.MapReduce.reduce = (ctx) => {
  const params = getParams();
  const invoices = ctx.values.flatMap((v) => JSON.parse(v) as OpenInvoice[]);
  const result: CustomerResult = {
    customerId: Number(ctx.key),
    customerName: invoices[0].customername,
    status: 'nothing',
    recipients: [],
    recipientSource: '',
    invoices: [],
    emails: 0,
    errors: [],
  };
  try {
    processCustomer(params, invoices, result);
  } catch (e) {
    result.status = 'failed';
    result.errors.push(errorMessage(e));
    log.error(`Customer ${ctx.key} (${result.customerName}) failed`, errorMessage(e));
  }
  ctx.write({ key: ctx.key, value: JSON.stringify(result) });
};

function processCustomer(params: Params, invoices: OpenInvoice[], result: CustomerResult): void {
  const { customerId, customerName } = result;
  const label = `Customer ${customerId} (${customerName})`;

  const rec = resolveRecipients(invoices[0].notifyemail, invoices[0].customeremail);
  if (rec.invalid.length) log.audit(`${label}: ignoring invalid email entries`, rec.invalid.join(', '));
  if (!rec.addresses.length) {
    result.status = 'skipped';
    log.audit(`${label}: skipped`, `no valid address in ${NOTIFY_EMAIL_FIELD} or the customer email field`);
    return;
  }
  if (rec.addresses.length > MAX_RECIPIENTS) log.audit(`${label}: more than ${MAX_RECIPIENTS} addresses`, `sending to the first ${MAX_RECIPIENTS} only`);
  const recipients = rec.addresses.slice(0, MAX_RECIPIENTS);
  result.recipientSource = rec.source === 'primary' ? NOTIFY_EMAIL_FIELD : 'email';

  const due = invoices.filter((inv) =>
    shouldSend(
      { daysOverdue: Number(inv.daysoverdue), lastSentDaysOverdue: inv.lastsentdaysoverdue == null ? null : Number(inv.lastsentdaysoverdue) },
      params.sendDaily,
    ),
  );
  if (!due.length) return;

  const rendered: Rendered[] = [];
  for (const inv of due) {
    const reserve = RENDER_UNITS + STAMP_UNITS * (rendered.length + 1) + FINISH_UNITS;
    if (runtime.getCurrentScript().getRemainingUsage() < reserve) {
      const left = due.slice(rendered.length).map((i) => i.tranid);
      result.errors.push(`Deferred to the next run (governance): ${left.join(', ')}`);
      log.audit(`${label}: governance low, deferring ${left.length} invoice(s)`, left.join(', '));
      break;
    }
    const file = render.transaction({ entityId: inv.invoiceid, printMode: render.PrintMode.PDF });
    file.name = `Invoice_${inv.tranid}.pdf`;
    rendered.push({ inv, file, bytes: fileBytes(file) });
  }
  if (!rendered.length) return;

  const { batches, oversize } = splitBySize(rendered, (r) => r.bytes);
  for (const o of oversize) {
    result.errors.push(`${o.inv.tranid}: PDF is ${mb(o.bytes)} MB, above the ${mb(MAX_BATCH_BYTES)} MB email limit; not sent`);
  }
  if (!batches.length) return;

  const merged = render.mergeEmail({ templateId: params.templateId, entity: { type: 'customer', id: customerId } });
  const author = senderFor(params, invoices[0].subsidiaryid);
  const tokens = { customerName, subsidiaryName: invoices[0].subsidiaryname || '' };

  batches.forEach((batch, i) => {
    const part = batches.length > 1 ? ` (${i + 1} of ${batches.length})` : '';
    const subject = fillTokens(merged.subject, tokens) + part;
    const body = fillTokens(merged.body, { ...tokens, invoiceTable: invoiceTable(batch.map((b) => b.inv)) });
    const tranids = batch.map((b) => b.inv.tranid);
    const bytes = batch.reduce((n, b) => n + b.bytes, 0);

    if (params.dryRun) {
      log.audit(`DRY RUN: would email ${label}`, { from: author, to: recipients, subject, invoices: tranids, attachmentMb: mb(bytes) });
    } else {
      email.send({
        author,
        recipients,
        subject,
        body,
        attachments: batch.map((b) => b.file),
        relatedRecords: { entityId: customerId, transactionId: batch[0].inv.invoiceid },
      });
      log.audit(`Emailed ${label}`, { from: author, to: recipients, subject, invoices: tranids, attachmentMb: mb(bytes) });
      for (const { inv } of batch) stamp(inv, result);
    }
    result.emails++;
    result.invoices.push(...tranids);
  });
  result.recipients = recipients;
  result.status = params.dryRun ? 'dry-run' : 'sent';
}

function stamp(inv: OpenInvoice, result: CustomerResult): void {
  try {
    record.submitFields({
      type: record.Type.INVOICE,
      id: inv.invoiceid,
      values: { custbody_ar_last_sent: new Date(), custbody_ar_send_count: Number(inv.sendcount || 0) + 1 },
      options: { enableSourcing: false, ignoreMandatoryFields: true },
    });
  } catch (e) {
    const msg = `${inv.tranid}: emailed, but stamping custbody_ar_last_sent/custbody_ar_send_count failed (${errorMessage(e)}); it will be emailed again on the next run`;
    result.errors.push(msg);
    log.error(`Invoice ${inv.invoiceid} stamp failed`, msg);
  }
}

export const summarize: EntryPoints.MapReduce.summarize = (summary) => {
  const params = getParams();
  const results: CustomerResult[] = [];
  summary.output.iterator().each((_key, value) => {
    results.push(JSON.parse(value));
    return true;
  });

  const uncaught: string[] = [];
  if (summary.inputSummary.error) uncaught.push(`getInputData: ${summary.inputSummary.error}`);
  summary.reduceSummary.errors.iterator().each((key, error) => {
    uncaught.push(`Customer ${key}: ${error}`);
    return true;
  });
  for (const u of uncaught) log.error('Unhandled error', u);

  const digest = digestHtml(results, uncaught, params.dryRun);
  log.audit(digest.subject, { seconds: summary.seconds, usage: summary.usage, yields: summary.yields });

  if (!params.digestRecipient) {
    log.audit('Digest not emailed', `set ${PARAM.digestRecipient} on the deployment to receive it`);
    return;
  }
  email.send({ author: params.defaultSender, recipients: [params.digestRecipient], subject: digest.subject, body: digest.body });
};

function fileBytes(f: File): number {
  const size = Number(f.size);
  return size > 0 ? size : Math.ceil(f.getContents().length * 0.75); // base64 fallback
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { name?: string; message?: string };
    return [err.name, err.message].filter(Boolean).join(': ') || JSON.stringify(e);
  }
  return String(e);
}
