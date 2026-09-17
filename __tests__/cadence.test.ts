import { shouldSend, TOUCHPOINTS } from '../src/TypeScript/lib/cadence';

describe('cadence: shouldSend', () => {
  it('sends never-sent invoices on the next run (day 0), due or not', () => {
    expect(shouldSend({ daysOverdue: -20, lastSentDaysOverdue: null })).toBe(true);
    expect(shouldSend({ daysOverdue: 45, lastSentDaysOverdue: null })).toBe(true);
  });

  it('does not resend before the invoice is overdue', () => {
    expect(shouldSend({ daysOverdue: -5, lastSentDaysOverdue: -20 })).toBe(false);
    expect(shouldSend({ daysOverdue: 0, lastSentDaysOverdue: -20 })).toBe(false);
  });

  it.each(TOUCHPOINTS)('sends when %i days overdue is reached', (touch) => {
    expect(shouldSend({ daysOverdue: touch, lastSentDaysOverdue: touch - 1 })).toBe(true);
  });

  it('sends only once per touch point', () => {
    expect(shouldSend({ daysOverdue: 2, lastSentDaysOverdue: 1 })).toBe(false);
    expect(shouldSend({ daysOverdue: 13, lastSentDaysOverdue: 7 })).toBe(false);
    expect(shouldSend({ daysOverdue: 29, lastSentDaysOverdue: 14 })).toBe(false);
    expect(shouldSend({ daysOverdue: 90, lastSentDaysOverdue: 30 })).toBe(false);
  });

  it('catches up a touch point missed by a skipped run', () => {
    expect(shouldSend({ daysOverdue: 9, lastSentDaysOverdue: 1 })).toBe(true); // day-7 run never happened
    expect(shouldSend({ daysOverdue: 9, lastSentDaysOverdue: 8 })).toBe(false); // ...unless it did
  });

  it('sends exactly five times over an invoice life cycle (day 0 + 1/7/14/30)', () => {
    let last: number | null = null;
    const sentOn: number[] = [];
    for (let day = -10; day <= 90; day++) {
      if (shouldSend({ daysOverdue: day, lastSentDaysOverdue: last })) {
        sentOn.push(day);
        last = day;
      }
    }
    expect(sentOn).toEqual([-10, 1, 7, 14, 30]);
  });

  it('daily mode sends on every run', () => {
    expect(shouldSend({ daysOverdue: 3, lastSentDaysOverdue: 2 }, true)).toBe(true);
    expect(shouldSend({ daysOverdue: -30, lastSentDaysOverdue: -31 }, true)).toBe(true);
  });
});

import { explainSend } from '../src/TypeScript/lib/cadence';

describe('cadence: explainSend reasons', () => {
  it('explains each verdict', () => {
    expect(explainSend({ daysOverdue: 5, lastSentDaysOverdue: 1 }, true)).toEqual({ send: true, reason: 'daily mode' });
    expect(explainSend({ daysOverdue: -3, lastSentDaysOverdue: null })).toEqual({ send: true, reason: 'never sent (day 0)' });
    expect(explainSend({ daysOverdue: 9, lastSentDaysOverdue: 1 })).toEqual({ send: true, reason: '7 days overdue' });
    expect(explainSend({ daysOverdue: -3, lastSentDaysOverdue: -10 })).toEqual({ send: false, reason: 'not overdue yet' });
    expect(explainSend({ daysOverdue: 10, lastSentDaysOverdue: 7 })).toEqual({ send: false, reason: '7-day touch already sent' });
    expect(explainSend({ daysOverdue: 45, lastSentDaysOverdue: 30 })).toEqual({ send: false, reason: '30-day touch already sent; no further touch points' });
  });
});
