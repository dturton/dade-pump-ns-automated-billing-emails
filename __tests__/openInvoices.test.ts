import { openInvoicesSql } from '../src/TypeScript/lib/openInvoices';

describe('openInvoicesSql', () => {
  it('has no bind parameters without filters and keeps every exclusion', () => {
    const { query, params } = openInvoicesSql();
    expect(params).toEqual([]);
    expect(query).not.toContain('?');
    expect(query).toContain("t.type = 'CustInvc'");
    expect(query).toContain("t.status = 'A'");
    expect(query).toContain("c.custentity_ar_send_invoices = 'T'");
    expect(query).toContain("NVL(t.custbody_ar_hold, 'F') = 'F'");
    expect(query).toContain('t.custbody_ar_last_sent < TRUNC(SYSDATE)');
    expect(query).toContain('ORDER BY t.entity');
  });

  it('adds customer and subsidiary filters as bind parameters, in order', () => {
    const { query, params } = openInvoicesSql({ customerId: 42, subsidiaryId: 3 });
    expect(params).toEqual([42, 3]);
    expect(query.indexOf('AND t.entity = ?')).toBeLessThan(query.indexOf('AND tl.subsidiary = ?'));
    expect(query.indexOf('AND tl.subsidiary = ?')).toBeLessThan(query.indexOf('ORDER BY'));
  });

  it('ignores empty filters', () => {
    expect(openInvoicesSql({ customerId: undefined, subsidiaryId: 0 }).params).toEqual([]);
  });
});
