import { CustomerResult, digestHtml } from '../src/TypeScript/lib/html';

const sent: CustomerResult = {
  customerId: 1,
  customerName: 'Acme & Co',
  status: 'sent',
  recipients: ['ap@acme.example'],
  recipientSource: 'email',
  invoices: ['INV-1', 'INV-2'],
  emails: 1,
  errors: [],
};

describe('digestHtml', () => {
  it('labels a scheduled run', () => {
    const d = digestHtml([sent], [], false);
    expect(d.subject).toBe('AR Invoice Sender: 1 sent, 0 skipped, 0 errors');
    expect(d.body).toContain('AR Invoice Sender run summary');
    expect(d.body).toContain('Acme &amp; Co');
  });

  it('labels a manual send and a dry run', () => {
    expect(digestHtml([sent], [], false, true).subject).toBe('AR Invoice Sender (manual send): 1 sent, 0 skipped, 0 errors');
    const dry = digestHtml([{ ...sent, status: 'dry-run' }], [], true, true);
    expect(dry.subject).toBe('[DRY RUN] AR Invoice Sender (manual send): 1 sent, 0 skipped, 0 errors');
    expect(dry.body).toContain('would be emailed');
  });
});
