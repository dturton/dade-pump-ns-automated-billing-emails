/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

/** Past-due touch points, in whole days after the due date. */
export const TOUCHPOINTS = [1, 7, 14, 30];

export interface CadenceInput {
  /** today - dueDate in days; negative while the invoice is not yet due */
  daysOverdue: number;
  /** lastSent - dueDate in days; null when the invoice was never sent */
  lastSentDaysOverdue: number | null;
}

export interface SendVerdict {
  send: boolean;
  reason: string;
}

/**
 * Day 0: an invoice that was never sent goes out on the next run.
 * After that it goes out again when a touch point (1/7/14/30 days overdue) has been
 * reached AND the last send happened before that touch point. Using "reached and not
 * yet covered" instead of "equals" means a run that was skipped (weekend outage, script
 * error) catches up on the next run instead of missing the touch entirely.
 * sendDaily: every open invoice, every run (the "sent today" filter still applies).
 */
export function explainSend(inv: CadenceInput, sendDaily = false): SendVerdict {
  if (sendDaily) return { send: true, reason: 'daily mode' };
  if (inv.lastSentDaysOverdue === null) return { send: true, reason: 'never sent (day 0)' };
  const last = inv.lastSentDaysOverdue;
  const touch = TOUCHPOINTS.find((t) => inv.daysOverdue >= t && last < t);
  if (touch !== undefined) return { send: true, reason: `${touch} days overdue` };
  if (inv.daysOverdue < TOUCHPOINTS[0]) return { send: false, reason: 'not overdue yet' };
  const reached = TOUCHPOINTS.filter((t) => t <= inv.daysOverdue).pop() as number;
  const final = reached === TOUCHPOINTS[TOUCHPOINTS.length - 1] ? '; no further touch points' : '';
  return { send: false, reason: `${reached}-day touch already sent${final}` };
}

export function shouldSend(inv: CadenceInput, sendDaily = false): boolean {
  return explainSend(inv, sendDaily).send;
}
