/**
 * @NApiVersion 2.1
 * @NScriptType MassUpdateScript
 * @NModuleScope SameAccount
 *
 * Lists > Mass Update > Mass Updates > Custom Updates > Customer > "AR Invoice Sender - Opt In Customers".
 * Checks Auto-Send Open Invoices (custentity_ar_send_invoices) on every customer matching the mass update criteria.
 * Exists because the custom checkbox does not appear on the General Updates field list in this account.
 */

import { EntryPoints } from 'N/types';
import * as record from 'N/record';

export const each: EntryPoints.MassUpdate.each = (context) => {
  record.submitFields({
    type: context.type,
    id: context.id,
    values: { custentity_ar_send_invoices: true },
    options: { ignoreMandatoryFields: true },
  });
};
