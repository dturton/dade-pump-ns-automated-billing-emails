/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

import * as query from 'N/query';
import { InvoiceRow } from './html';

/** Customer field holding the invoice recipient address(es); falls back to the standard email field. */
export const NOTIFY_EMAIL_FIELD = 'custentity_2663_email_address_notif';

/** One row of the open-invoice query. Shared by the Map/Reduce and the preview Suitelet. */
export interface OpenInvoice extends InvoiceRow {
  invoiceid: number;
  customerid: number;
  customername: string;
  /** value of NOTIFY_EMAIL_FIELD (free text, may hold several addresses) */
  notifyemail: string | null;
  /** standard customer email, used when notifyemail has no valid address */
  customeremail: string | null;
  subsidiaryid: number | null;
  subsidiaryname: string | null;
  /** today - due date, in days (negative = not yet due) */
  daysoverdue: number;
  /** last send date - due date, in days; null = never sent */
  lastsentdaysoverdue: number | null;
  /** YYYY-MM-DD, null = never sent */
  lastsent: string | null;
  sendcount: number;
}

export interface OpenInvoiceFilters {
  customerId?: number;
  subsidiaryId?: number;
}

// All date arithmetic happens in SQL so the scripts only deal with whole-day integers and ISO strings.
// Excludes: customer opt-in unchecked, invoice on hold, invoice already sent today.
// t.status holds the bare code in SuiteQL ('A' = Open); the 'CustInvc:A' form is for N/search and never matches here.
const BASE_SQL = `
  SELECT
    t.id                                   AS invoiceid,
    t.tranid                               AS tranid,
    t.entity                               AS customerid,
    BUILTIN.DF(t.entity)                   AS customername,
    c.${NOTIFY_EMAIL_FIELD}   AS notifyemail,
    c.email                                AS customeremail,
    tl.subsidiary                          AS subsidiaryid,
    BUILTIN.DF(tl.subsidiary)              AS subsidiaryname,
    TO_CHAR(t.trandate, 'YYYY-MM-DD')      AS trandate,
    TO_CHAR(t.duedate, 'YYYY-MM-DD')       AS duedate,
    t.foreignamountunpaid                  AS amountunpaid,
    cur.symbol                             AS currency,
    TRUNC(SYSDATE) - t.duedate             AS daysoverdue,
    t.custbody_ar_last_sent - t.duedate    AS lastsentdaysoverdue,
    TO_CHAR(t.custbody_ar_last_sent, 'YYYY-MM-DD') AS lastsent,
    NVL(t.custbody_ar_send_count, 0)       AS sendcount
  FROM transaction t
  JOIN customer c ON c.id = t.entity
  JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'
  LEFT JOIN currency cur ON cur.id = t.currency
  WHERE t.type = 'CustInvc'
    AND t.status = 'A'
    AND c.custentity_ar_send_invoices = 'T'
    AND NVL(t.custbody_ar_hold, 'F') = 'F'
    AND (t.custbody_ar_last_sent IS NULL OR t.custbody_ar_last_sent < TRUNC(SYSDATE))
    AND NVL(t.foreignamountunpaid, 0) > 0
    /*FILTERS*/
  ORDER BY t.entity, t.duedate, t.tranid
`;

/** The open-invoice SuiteQL plus bind parameters for the optional filters. */
export function openInvoicesSql(filters: OpenInvoiceFilters = {}): { query: string; params: number[] } {
  const clauses: string[] = [];
  const params: number[] = [];
  if (filters.customerId) {
    clauses.push('AND t.entity = ?');
    params.push(filters.customerId);
  }
  if (filters.subsidiaryId) {
    clauses.push('AND tl.subsidiary = ?');
    params.push(filters.subsidiaryId);
  }
  return { query: BASE_SQL.replace('/*FILTERS*/', clauses.join('\n    ')), params };
}

/** Streams every matching row (1000 per page). Return false from the callback to stop early. */
export function forEachOpenInvoice(filters: OpenInvoiceFilters, callback: (row: OpenInvoice) => boolean | void): void {
  const sql = openInvoicesSql(filters);
  let stop = false;
  query
    .runSuiteQLPaged({ query: sql.query, params: sql.params, pageSize: 1000 })
    .iterator()
    .each((page) => {
      for (const row of page.value.data.asMappedResults<OpenInvoice>()) {
        if (callback(row) === false) {
          stop = true;
          break;
        }
      }
      return !stop;
    });
}
