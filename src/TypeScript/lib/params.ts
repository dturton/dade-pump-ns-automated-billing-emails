/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

import * as runtime from 'N/runtime';

export const PARAM = {
  senderMap: 'custscript_ar_sender_map',
  defaultSender: 'custscript_ar_default_sender',
  digestRecipient: 'custscript_ar_digest_recipient',
  templateId: 'custscript_ar_email_template',
  dryRun: 'custscript_ar_dry_run',
  sendDaily: 'custscript_ar_send_daily',
  customer: 'custscript_ar_customer',
  invoiceIds: 'custscript_ar_invoice_ids',
} as const;

/** Map/Reduce script id and the deployment the preview page submits manual sends to. */
export const SENDER_SCRIPT_ID = 'customscript_ar_invoice_sender_mr';
export const SELECTED_DEPLOYMENT_ID = 'customdeploy_ar_invoice_sender_selected';

export interface Params {
  /** subsidiary internal id -> sender employee internal id */
  senderMap: Record<string, number>;
  defaultSender: number;
  digestRecipient: string;
  templateId: number;
  dryRun: boolean;
  sendDaily: boolean;
  /** when set, only this customer's invoices are processed (manual/test deployment) */
  customerId?: number;
  /**
   * When set (manual send from the preview page), exactly these invoices are emailed:
   * the cadence, the "sent today" exclusion and Dry Run are bypassed; on hold and opt-out still apply.
   */
  invoiceIds?: number[];
}

/** Parses the sender-map parameter: a JSON object {"<subsidiaryId>": <employeeId>}. Invalid JSON throws. */
export function parseSenderMap(raw: unknown): Record<string, number> {
  const text = String(raw ?? '').trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`${PARAM.senderMap} is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${PARAM.senderMap} must be a JSON object like {"1": 12, "3": 45}`);
  }
  const map: Record<string, number> = {};
  for (const [sub, emp] of Object.entries(parsed as Record<string, unknown>)) {
    const subId = Number(sub);
    const empId = Number(emp);
    if (Number.isInteger(subId) && subId > 0 && Number.isInteger(empId) && empId > 0) map[String(subId)] = empId;
  }
  return map;
}

/**
 * Parses the invoice-ids parameter: a JSON array or a comma/semicolon/whitespace-separated list of
 * invoice internal ids. Returns unique positive integers in input order; any other token throws.
 */
export function parseInvoiceIds(raw: unknown): number[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  let tokens: unknown[];
  if (text.startsWith('[')) {
    try {
      tokens = JSON.parse(text) as unknown[];
    } catch (e) {
      throw new Error(`${PARAM.invoiceIds} is not valid JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(tokens)) throw new Error(`${PARAM.invoiceIds} must be a JSON array or a comma-separated list of invoice internal ids`);
  } else {
    tokens = text.split(/[\s,;]+/).filter(Boolean);
  }
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const t of tokens) {
    const id = Number(t);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${PARAM.invoiceIds}: "${String(t)}" is not an invoice internal id`);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Checkbox parameters read back as booleans; overrides passed through N/task may arrive as 'T'/'F'. */
export function isChecked(value: unknown): boolean {
  return value === true || value === 'T' || value === 'true';
}

export function senderFor(params: Pick<Params, 'senderMap' | 'defaultSender'>, subsidiaryId: number | string | null | undefined): number {
  const mapped = subsidiaryId == null ? undefined : params.senderMap[String(subsidiaryId)];
  return mapped || params.defaultSender;
}

/** Reads and validates all script parameters. Throws on missing required configuration. */
export function getParams(): Params {
  const script = runtime.getCurrentScript();
  const get = (name: string) => script.getParameter({ name });

  const defaultSender = Number(get(PARAM.defaultSender));
  if (!defaultSender) throw new Error(`Script parameter ${PARAM.defaultSender} (default sender employee) is required`);
  const templateId = Number(get(PARAM.templateId));
  if (!templateId) throw new Error(`Script parameter ${PARAM.templateId} (email template internal id) is required`);

  const invoiceIds = parseInvoiceIds(get(PARAM.invoiceIds));
  const manual = invoiceIds.length > 0;
  const params: Params = {
    senderMap: parseSenderMap(get(PARAM.senderMap)),
    defaultSender,
    templateId,
    digestRecipient: String(get(PARAM.digestRecipient) ?? '').trim(),
    // A manual send (Invoice IDs set) is always real: the user confirmed it on the preview page, and a
    // false Dry Run override passed through N/task is dropped, which would leave the deployment's
    // default-checked Dry Run in force.
    dryRun: manual ? false : isChecked(get(PARAM.dryRun)),
    sendDaily: isChecked(get(PARAM.sendDaily)),
    customerId: Number(get(PARAM.customer)) || undefined,
  };
  if (manual) params.invoiceIds = invoiceIds;
  return params;
}
