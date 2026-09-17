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
} as const;

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

  return {
    senderMap: parseSenderMap(get(PARAM.senderMap)),
    defaultSender,
    templateId,
    digestRecipient: String(get(PARAM.digestRecipient) ?? '').trim(),
    dryRun: get(PARAM.dryRun) === true,
    sendDaily: get(PARAM.sendDaily) === true,
    customerId: Number(get(PARAM.customer)) || undefined,
  };
}
