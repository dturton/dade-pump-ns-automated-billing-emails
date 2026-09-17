import * as runtime from 'N/runtime';
import { getParams, PARAM, parseSenderMap, senderFor } from '../src/TypeScript/lib/params';

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

  it('fails fast when the default sender or template id is missing', () => {
    stubParameters({ [PARAM.templateId]: 123 });
    expect(() => getParams()).toThrow(PARAM.defaultSender);
    stubParameters({ [PARAM.defaultSender]: 99 });
    expect(() => getParams()).toThrow(PARAM.templateId);
  });
});
