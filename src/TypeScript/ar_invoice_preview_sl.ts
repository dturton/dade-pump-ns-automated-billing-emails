/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Preview: every invoice the AR Invoice Sender's query returns, with the cadence verdict for today.
 * The page itself sends nothing. "Send Selected" queues the Map/Reduce (deployment
 * customdeploy_ar_invoice_sender_selected) with the ticked invoice ids; that run bypasses the cadence
 * and the "sent today" exclusion for those invoices, always sends for real (Dry Run is ignored on a
 * manual send), stamps the invoices as usual and emails the digest.
 */

import { EntryPoints } from 'N/types';
import * as log from 'N/log';
import * as runtime from 'N/runtime';
import * as serverWidget from 'N/ui/serverWidget';
import * as task from 'N/task';
import * as url from 'N/url';
import { explainSend, SendVerdict } from './lib/cadence';
import { resolveRecipients } from './lib/emailAddress';
import { escapeHtml, formatAmount, formatDate } from './lib/html';
import { forEachOpenInvoice, OpenInvoice, OpenInvoiceFilters, openInvoicesSql } from './lib/openInvoices';
import { PARAM, parseInvoiceIds, SELECTED_DEPLOYMENT_ID, SENDER_SCRIPT_ID } from './lib/params';

/** ponytail: hard cap on rows rendered into one page; use the filters beyond this. */
const MAX_ROWS = 2000;
/** Hidden fields the Send Selected button fills in before submitting the form. */
const F_ACTION = 'custpage_action';
const F_SEND_IDS = 'custpage_send_ids';
const ACTION_SEND = 'send';
/** Map/Reduce Script Status page (Customization > Scripting > Map/Reduce Script Status). */
const MR_STATUS_PATH = '/app/common/scripting/mapreducescriptstatus.nl';

interface PreviewRow {
  inv: OpenInvoice;
  recipients: string[];
  /** 'primary' = notification field, 'fallback' = customer email field */
  source: string;
  verdict: SendVerdict;
}

interface PageState {
  filters: OpenInvoiceFilters;
  sendDaily: boolean;
  onlySending: boolean;
}

export const onRequest: EntryPoints.Suitelet.onRequest = (ctx) => {
  const p = ctx.request.parameters as Record<string, string | undefined>;
  const state: PageState = {
    filters: {
      customerId: Number(p.custpage_customer) || undefined,
      subsidiaryId: Number(p.custpage_subsidiary) || undefined,
    },
    sendDaily: p.custpage_daily === 'T',
    onlySending: p.custpage_only_sending === 'T',
  };

  if (ctx.request.method === 'POST' && p[F_ACTION] === ACTION_SEND) {
    ctx.response.writePage(sendSelected(p[F_SEND_IDS], state));
    return;
  }
  ctx.response.writePage(previewPage(state));
};

function previewPage(state: PageState): serverWidget.Form {
  const { filters, sendDaily, onlySending } = state;
  const form = serverWidget.createForm({ title: 'AR Invoice Sender - Preview' });
  form.addFieldGroup({ id: 'custpage_filters', label: 'Filters' });
  const fld = (id: string, type: serverWidget.FieldType, label: string, source?: string) =>
    form.addField({ id, type, label, source, container: 'custpage_filters' });
  fld('custpage_customer', serverWidget.FieldType.SELECT, 'Customer', 'customer').defaultValue = filters.customerId ? String(filters.customerId) : '';
  fld('custpage_subsidiary', serverWidget.FieldType.SELECT, 'Subsidiary', 'subsidiary').defaultValue = filters.subsidiaryId ? String(filters.subsidiaryId) : '';
  fld('custpage_daily', serverWidget.FieldType.CHECKBOX, 'Evaluate as Send Daily').defaultValue = sendDaily ? 'T' : 'F';
  fld('custpage_only_sending', serverWidget.FieldType.CHECKBOX, 'Only invoices sending today').defaultValue = onlySending ? 'T' : 'F';

  form.addField({ id: F_ACTION, type: serverWidget.FieldType.TEXT, label: 'Action' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
  form.addField({ id: F_SEND_IDS, type: serverWidget.FieldType.LONGTEXT, label: 'Selected invoice ids' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

  form.addSubmitButton({ label: 'Refresh' });
  form.addButton({ id: 'custpage_send_selected', label: 'Send Selected', functionName: sendButtonJs() });

  const rows: PreviewRow[] = [];
  let truncated = false;
  forEachOpenInvoice({ ...filters, includeSentToday: true }, (inv) => {
    const rec = resolveRecipients(inv.notifyemail, inv.customeremail);
    const verdict = verdictFor(inv, rec.addresses, sendDaily);
    if (onlySending && !verdict.send) return;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      return false;
    }
    rows.push({ inv, recipients: rec.addresses, source: rec.source, verdict });
  });

  const results = form.addField({ id: 'custpage_results', type: serverWidget.FieldType.INLINEHTML, label: 'Results' });
  results.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW });
  results.defaultValue = renderResults(rows, truncated, sendDaily) + renderSql(filters) + resetActionJs();
  return form;
}

/**
 * Browsers may restore form values (hidden fields included) on Back/Reload; without this a plain
 * Refresh could replay a previous Send Selected. Clears the action fields on load and on pageshow.
 */
function resetActionJs(): string {
  return (
    `<script>(function(){function reset(){['${F_ACTION}','${F_SEND_IDS}'].forEach(function(n){` +
    `Array.prototype.forEach.call(document.getElementsByName(n),function(e){e.value='';});});}` +
    `reset();window.addEventListener('pageshow',reset);})();</script>`
  );
}

/** Today's verdict for the scheduled run: no address wins over everything, then "sent today", then the cadence. */
function verdictFor(inv: OpenInvoice, recipients: string[], sendDaily: boolean): SendVerdict {
  if (!recipients.length) return { send: false, reason: 'customer skipped: no valid email address' };
  if (inv.senttoday === 'T') return { send: false, reason: 'already sent today' };
  return explainSend({ daysOverdue: Number(inv.daysoverdue), lastSentDaysOverdue: inv.lastsentdaysoverdue == null ? null : Number(inv.lastsentdaysoverdue) }, sendDaily);
}

/**
 * Client-side handler for the Send Selected button, rendered by NetSuite into the button's onclick.
 * Collects the ticked invoice ids into the hidden field, confirms, then submits the Suitelet form.
 * Uses no double quotes (the attribute is double-quoted) and returns a no-op function so it also works
 * if NetSuite appends "()" to the expression. Lives here so the page needs no separate client script.
 */
function sendButtonJs(): string {
  return (
    '(function(){' +
    `var picks=document.querySelectorAll('input.ar-pick:checked');var ids=[];` +
    'Array.prototype.forEach.call(picks,function(b){ids.push(b.value);});' +
    `if(!ids.length){alert('Tick at least one invoice first.');return function(){};}` +
    `if(!confirm('Email '+ids.length+' invoice(s) to their customers now? This bypasses the cadence and stamps the invoices as sent.')){return function(){};}` +
    `var target=document.getElementsByName('${F_SEND_IDS}');var form=null;` +
    `Array.prototype.forEach.call(target,function(t){t.value=ids.join(',');form=form||t.form;});` +
    `Array.prototype.forEach.call(document.getElementsByName('${F_ACTION}'),function(a){a.value='${ACTION_SEND}';});` +
    'if(form){form.submit();}else{alert(\'Could not find the form to submit.\');}' +
    'return function(){};' +
    '})()'
  );
}

/**
 * POST handler for Send Selected: re-validates the ids against the live query (still open, opted in,
 * not on hold, with a valid address), then queues the Map/Reduce on the dedicated deployment.
 */
function sendSelected(rawIds: string | undefined, state: PageState): serverWidget.Form {
  const form = serverWidget.createForm({ title: 'AR Invoice Sender - Manual send' });
  const backUrl = url.resolveScript({
    scriptId: runtime.getCurrentScript().id,
    deploymentId: runtime.getCurrentScript().deploymentId,
    params: {
      custpage_customer: state.filters.customerId || '',
      custpage_subsidiary: state.filters.subsidiaryId || '',
      custpage_daily: state.sendDaily ? 'T' : 'F',
      custpage_only_sending: state.onlySending ? 'T' : 'F',
    },
  });
  const summary = form.addField({ id: 'custpage_summary', type: serverWidget.FieldType.INLINEHTML, label: 'Summary' });
  const page = (html: string) => {
    summary.defaultValue = `<div style="font-family:Arial,sans-serif;font-size:13px;">${html}<p><a href="${escapeHtml(backUrl)}">Back to the preview</a></p></div>`;
    return form;
  };
  const err = (msg: string) => page(`<p style="color:#a00;"><b>Nothing was queued.</b> ${escapeHtml(msg)}</p>`);

  let requested: number[];
  try {
    requested = parseInvoiceIds(rawIds);
  } catch (e) {
    return err(`The selection could not be read: ${errorMessage(e)}`);
  }
  if (!requested.length) return err('No invoices were selected.');

  const accepted: OpenInvoice[] = [];
  const noAddress: OpenInvoice[] = [];
  forEachOpenInvoice({ invoiceIds: requested, includeSentToday: true }, (inv) => {
    if (resolveRecipients(inv.notifyemail, inv.customeremail).addresses.length) accepted.push(inv);
    else noAddress.push(inv);
  });
  const seen = new Set([...accepted, ...noAddress].map((i) => i.invoiceid));
  const gone = requested.filter((id) => !seen.has(id));

  const user = runtime.getCurrentUser();
  const li = (s: string) => `<li>${s}</li>`;
  const tranids = (list: OpenInvoice[]) => escapeHtml(list.map((i) => i.tranid).join(', '));
  const skippedHtml =
    (noAddress.length ? `<p>Skipped, customer has no valid email address: ${tranids(noAddress)}.</p>` : '') +
    (gone.length ? `<p>Skipped, no longer eligible (paid, closed, on hold, or customer opted out): internal id(s) ${escapeHtml(gone.join(', '))}.</p>` : '');

  if (!accepted.length) return page(`<p style="color:#a00;"><b>Nothing was queued.</b> None of the selected invoices can be sent.</p>${skippedHtml}`);

  let taskId: string;
  try {
    const mr = task.create({
      taskType: task.TaskType.MAP_REDUCE,
      scriptId: SENDER_SCRIPT_ID,
      deploymentId: SELECTED_DEPLOYMENT_ID,
      // Only the invoice ids are overridden. Dry Run is deliberately not passed: N/task drops a false
      // override and the deployment's own (default-checked) Dry Run would win, so the Map/Reduce
      // ignores Dry Run altogether whenever Invoice IDs is set.
      params: { [PARAM.invoiceIds]: accepted.map((i) => i.invoiceid).join(',') },
    });
    taskId = mr.submit();
  } catch (e) {
    log.error('Manual send could not be queued', { user: user.id, invoices: accepted.map((i) => i.invoiceid), error: errorMessage(e) });
    return err(
      `The Map/Reduce could not be queued (${errorMessage(e)}). If a previous manual send is still running, wait for it to finish and try again. ` +
        `Also check that the deployment ${SELECTED_DEPLOYMENT_ID} exists and is configured.`,
    );
  }

  const customers = new Set(accepted.map((i) => i.customerid)).size;
  log.audit('Manual send queued', { user: `${user.name} (${user.id})`, taskId, invoices: accepted.map((i) => i.tranid) });
  const mode = `<p>The selected invoices are being emailed to their customers and stamped as sent. The digest reports the result.</p>`;
  return page(
    `<p><b>Queued ${accepted.length} invoice(s) for ${customers} customer(s).</b> Task id ${escapeHtml(taskId)}.</p>` +
      mode +
      `<ul>${accepted.map((i) => li(`${escapeHtml(i.customername)}: ${escapeHtml(i.tranid)}`)).join('')}</ul>` +
      skippedHtml +
      `<p>Progress: <a href="${MR_STATUS_PATH}" target="_blank">Map/Reduce Script Status</a> (deployment "AR Invoice Sender - selected invoices").</p>`,
  );
}

const TD = 'padding:5px 8px;border-bottom:1px solid #ddd;white-space:nowrap;';

/** The exact SuiteQL this page ran, with the bind values inlined so it can be pasted into a SuiteQL tool. */
function renderSql(filters: OpenInvoiceFilters): string {
  const sql = openInvoicesSql({ ...filters, includeSentToday: true });
  let i = 0;
  const inlined = sql.query.replace(/\?/g, () => String(sql.params[i++]));
  return `<details style="margin-top:12px;font-family:Arial,sans-serif;font-size:12px;"><summary>SuiteQL used for this preview</summary><pre>${escapeHtml(inlined)}</pre></details>`;
}

function renderResults(rows: PreviewRow[], truncated: boolean, sendDaily: boolean): string {
  const customers = new Set(rows.map((r) => r.inv.customerid));
  const sending = rows.filter((r) => r.verdict.send);
  const sendingCustomers = new Set(sending.map((r) => r.inv.customerid));
  const noEmail = new Set(rows.filter((r) => !r.recipients.length).map((r) => r.inv.customerid));
  const sentToday = rows.filter((r) => r.inv.senttoday === 'T').length;
  const unpaid = new Map<string, number>();
  for (const r of rows) unpaid.set(r.inv.currency || '', (unpaid.get(r.inv.currency || '') || 0) + (Number(r.inv.amountunpaid) || 0));
  const totals = [...unpaid.entries()].map(([cur, n]) => `${escapeHtml(cur)} ${formatAmount(n)}`).join('; ');

  const link = (recordType: string, recordId: number, text: string) =>
    `<a href="${escapeHtml(url.resolveRecord({ recordType, recordId, isEditMode: false }))}" target="_blank">${escapeHtml(text)}</a>`;

  const body = rows
    .map((r) => {
      const selectable = r.recipients.length > 0;
      const bg = !selectable ? '#fde8e8' : r.inv.senttoday === 'T' ? '#f4f4f4' : r.verdict.send ? '#e6f4ea' : '';
      const tr = `<tr style="background:${bg};">`;
      const pick = selectable
        ? `<input type="checkbox" class="ar-pick" value="${r.inv.invoiceid}" title="Select ${escapeHtml(r.inv.tranid)} for Send Selected">`
        : `<input type="checkbox" disabled title="Cannot send: no valid email address">`;
      return (
        tr +
        `<td style="${TD}text-align:center;">${pick}</td>` +
        `<td style="${TD}">${link('customer', r.inv.customerid, r.inv.customername)}</td>` +
        `<td style="${TD}${selectable ? '' : 'color:#a00;'}">${
          selectable
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
  const toggleAll =
    `<th style="${TD}text-align:center;"><input type="checkbox" title="Select / clear all selectable rows" ` +
    `onclick="var c=this.checked;Array.prototype.forEach.call(document.querySelectorAll('input.ar-pick'),function(b){b.checked=c;});"></th>`;
  return (
    `<div style="font-family:Arial,sans-serif;font-size:12px;margin-top:10px;">` +
    `<p><b>${rows.length}</b> open invoice(s) for <b>${customers.size}</b> customer(s) match the AR Invoice Sender query` +
    `${sendDaily ? ' (evaluated as Send Daily)' : ''}. ` +
    `Sending today: <b>${sending.length}</b> invoice(s) to <b>${sendingCustomers.size}</b> customer(s). ` +
    `Already sent today: <b>${sentToday}</b>. ` +
    `Customers with no valid email address: <b>${noEmail.size}</b>. Unpaid total: ${totals || '0.00'}.</p>` +
    `<p>Tick invoices and use <b>Send Selected</b> to email them now, regardless of the cadence (invoices already sent today may be re-sent). ` +
    `Rows without a valid email address cannot be selected; invoices on hold are not listed.</p>` +
    (truncated ? `<p style="color:#a00;">Only the first ${MAX_ROWS} rows are shown. Narrow the filters to see the rest.</p>` : '') +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    `<thead><tr style="background:#f2f2f2;">${toggleAll}${th('Customer')}${th('Recipients')}${th('Subsidiary')}${th('Invoice #')}${th('Invoice Date')}${th('Due Date')}` +
    `${th('Days Overdue', true)}${th('Amount Unpaid', true)}${th('Last Sent')}${th('Sent Count', true)}${th('Sends Today?')}</tr></thead>` +
    `<tbody>${body}</tbody></table></div>`
  );
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { name?: string; message?: string };
    return [err.name, err.message].filter(Boolean).join(': ') || JSON.stringify(e);
  }
  return String(e);
}
