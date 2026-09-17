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

describe('openInvoicesSql: manual send filters', () => {
  it('excludes invoices sent today by default and returns a senttoday column', () => {
    const { query } = openInvoicesSql();
    expect(query).toContain('t.custbody_ar_last_sent < TRUNC(SYSDATE)');
    expect(query).toContain('AS senttoday');
  });

  it('keeps invoices sent today when includeSentToday is set', () => {
    const { query, params } = openInvoicesSql({ includeSentToday: true });
    expect(query).not.toContain('t.custbody_ar_last_sent < TRUNC(SYSDATE)');
    expect(query).toContain("NVL(t.custbody_ar_hold, 'F') = 'F'"); // on hold is still excluded
    expect(params).toEqual([]);
  });

  it('restricts to the given invoice ids with bind parameters, after the other filters', () => {
    const { query, params } = openInvoicesSql({ customerId: 42, invoiceIds: [7, 8, 9] });
    expect(params).toEqual([42, 7, 8, 9]);
    expect(query).toContain('AND (t.id IN (?, ?, ?))');
    expect(query.indexOf('AND t.entity = ?')).toBeLessThan(query.indexOf('t.id IN'));
  });

  it('splits long id lists into IN groups of at most 500', () => {
    const ids = Array.from({ length: 1201 }, (_, i) => i + 1);
    const { query, params } = openInvoicesSql({ invoiceIds: ids });
    expect(params).toEqual(ids);
    const groups = query.match(/t\.id IN \(([^)]*)\)/g) as string[];
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.split('?').length - 1)).toEqual([500, 500, 201]);
    expect(query).toContain(') OR t.id IN (');
  });

  it('ignores an empty id list', () => {
    const { query, params } = openInvoicesSql({ invoiceIds: [] });
    expect(params).toEqual([]);
    expect(query).not.toContain('t.id IN');
  });
});
