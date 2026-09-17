import * as runtime from 'N/runtime';
import { getParams, isChecked, PARAM, parseInvoiceIds, parseSenderMap, senderFor } from '../src/TypeScript/lib/params';

jest.mock('N/runtime');

function stubParameters(values: Record<string, unknown>) {
  (runtime.getCurrentScript as unknown as jest.Mock).mockReturnValue({
    getParameter: ({ name }: { name: string }) => values[name],
  });
}

describe('parseSenderMap', () => {
  it('returns an empty map for blank input', () => {
    expect(parseSenderMap('')).toEqual({});
    expect(parseSenderMap(null)).toEqual({});
  });

  it('parses subsidiary -> employee ids and drops junk entries', () => {
    expect(parseSenderMap('{"1": 12, "3": "45", "x": 7, "4": "nope", "5": 0}')).toEqual({ '1': 12, '3': 45 });
  });

  it('rejects invalid JSON and non-objects with a message naming the parameter', () => {
    expect(() => parseSenderMap('{1: 2}')).toThrow(PARAM.senderMap);
    expect(() => parseSenderMap('[1, 2]')).toThrow(PARAM.senderMap);
  });
});

describe('parseInvoiceIds', () => {
  it('returns an empty list for blank input', () => {
    expect(parseInvoiceIds('')).toEqual([]);
    expect(parseInvoiceIds(null)).toEqual([]);
    expect(parseInvoiceIds(undefined)).toEqual([]);
  });

  it('accepts comma, semicolon or whitespace separated ids and de-duplicates in order', () => {
    expect(parseInvoiceIds('12, 7;7\n 12 30')).toEqual([12, 7, 30]);
    expect(parseInvoiceIds(' 5 ')).toEqual([5]);
  });

  it('accepts a JSON array of numbers or numeric strings', () => {
    expect(parseInvoiceIds('[3, "4", 3]')).toEqual([3, 4]);
  });

  it('rejects anything that is not a positive integer id, naming the parameter', () => {
    expect(() => parseInvoiceIds('1,abc')).toThrow(PARAM.invoiceIds);
    expect(() => parseInvoiceIds('0')).toThrow(PARAM.invoiceIds);
    expect(() => parseInvoiceIds('1.5')).toThrow(PARAM.invoiceIds);
    expect(() => parseInvoiceIds('[1,')).toThrow(PARAM.invoiceIds);
    expect(() => parseInvoiceIds('[{"a":1}]')).toThrow(PARAM.invoiceIds);
  });
});

describe('isChecked', () => {
  it('accepts the stored boolean and the T/true forms a task override may deliver', () => {
    expect(isChecked(true)).toBe(true);
    expect(isChecked('T')).toBe(true);
    expect(isChecked('true')).toBe(true);
    expect(isChecked(false)).toBe(false);
    expect(isChecked('F')).toBe(false);
    expect(isChecked(undefined)).toBe(false);
    expect(isChecked('')).toBe(false);
  });
});

describe('senderFor', () => {
  const params = { senderMap: { '1': 12, '3': 45 }, defaultSender: 99 };
  it('uses the mapped employee for the subsidiary', () => {
    expect(senderFor(params, 3)).toBe(45);
    expect(senderFor(params, '1')).toBe(12);
  });
  it('falls back to the default sender', () => {
    expect(senderFor(params, 2)).toBe(99);
    expect(senderFor(params, null)).toBe(99);
  });
});

describe('getParams (N/runtime stub)', () => {
  it('reads and normalizes every script parameter', () => {
    stubParameters({
      [PARAM.senderMap]: '{"1": 12}',
      [PARAM.defaultSender]: '99',
      [PARAM.digestRecipient]: ' ar-team@example.com ',
      [PARAM.templateId]: 123,
      [PARAM.dryRun]: true,
      [PARAM.sendDaily]: false,
      [PARAM.customer]: '42',
    });
    expect(getParams()).toEqual({
      senderMap: { '1': 12 },
      defaultSender: 99,
      digestRecipient: 'ar-team@example.com',
      templateId: 123,
      dryRun: true,
      sendDaily: false,
      customerId: 42,
    });
  });

  it('leaves invoiceIds undefined when the parameter is empty', () => {
    stubParameters({ [PARAM.defaultSender]: '99', [PARAM.templateId]: 123, [PARAM.invoiceIds]: '' });
    expect(getParams().invoiceIds).toBeUndefined();
    expect('invoiceIds' in getParams()).toBe(false);
  });

  it('reads the manual-send invoice ids and checkbox overrides passed as T/F', () => {
    stubParameters({ [PARAM.defaultSender]: '99', [PARAM.templateId]: 123, [PARAM.invoiceIds]: '101,102,101', [PARAM.dryRun]: 'T', [PARAM.sendDaily]: 'F' });
    const params = getParams();
    expect(params.invoiceIds).toEqual([101, 102]);
    expect(params.dryRun).toBe(true);
    expect(params.sendDaily).toBe(false);
  });

  it('rejects a malformed invoice-ids parameter', () => {
    stubParameters({ [PARAM.defaultSender]: '99', [PARAM.templateId]: 123, [PARAM.invoiceIds]: '1,x' });
    expect(() => getParams()).toThrow(PARAM.invoiceIds);
  });

  it('fails fast when the default sender or template id is missing', () => {
    stubParameters({ [PARAM.templateId]: 123 });
    expect(() => getParams()).toThrow(PARAM.defaultSender);
    stubParameters({ [PARAM.defaultSender]: 99 });
    expect(() => getParams()).toThrow(PARAM.templateId);
  });
});
