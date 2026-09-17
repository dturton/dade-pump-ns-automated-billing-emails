# AR Invoice Sender (NetSuite SDF project)

Map/Reduce script that emails each opted-in customer their open invoices as PDF attachments,
following a cadence (day 0, then 1 / 7 / 14 / 30 days overdue) or daily, and sends an internal digest.
A preview page shows what the next run will do and lets a user pick invoices to email right away.
The scheduled run is currently deployed **Not Scheduled**; see "First-run configuration" to turn it on.

* SuiteScript 2.1, written in TypeScript (`src/TypeScript`) and compiled to AMD into
  `src/FileCabinet/SuiteScripts/ar-invoice-sender/`.
* SuiteCloud Development Framework (SDF) account-customization project (`src/`), deployable with the SuiteCloud CLI.
* Jest unit tests on top of SuiteCloud Unit Testing (`__tests__/`).
* OneWorld aware: the sender employee is chosen per subsidiary.

## Contents

| Path | Purpose |
| --- | --- |
| `src/TypeScript/ar_invoice_sender_mr.ts` | Map/Reduce entry points: `getInputData`, `reduce`, `summarize` |
| `src/TypeScript/ar_invoice_preview_sl.ts` | Suitelet: preview of the query results and today's verdicts; **Send Selected** queues a manual send |
| `src/TypeScript/ar_optin_customers_mu.ts` | Mass update script: checks the opt-in on matching customers |
| `src/TypeScript/lib/openInvoices.ts` | The open-invoice SuiteQL (shared by both scripts) |
| `src/TypeScript/lib/cadence.ts` | Cadence decision (`shouldSend` / `explainSend`) |
| `src/TypeScript/lib/emailAddress.ts` | Parsing/validation of the free-text notification field, with the Email field fallback |
| `src/TypeScript/lib/batching.ts` | Attachment size batching (keeps each email under 15 MB) |
| `src/TypeScript/lib/params.ts` | Script parameter access and sender-map parsing |
| `src/TypeScript/lib/html.ts` | Invoice summary table, template tokens, digest email |
| `src/Objects/custentity_ar_send_invoices.xml` | Customer opt-in checkbox |
| `src/Objects/custbody_ar_last_sent.xml`, `custbody_ar_send_count.xml`, `custbody_ar_hold.xml` | Invoice tracking fields |
| `src/Objects/custemailtmpl_ar_invoice_reminder.xml` (+ `.template.html`) | Customer-facing email template |
| `src/Objects/customscript_ar_invoice_sender_mr.xml` | Script record, parameters and the daily, manual (per customer) and selected-invoices deployments |
| `src/Objects/customscript_ar_invoice_preview_sl.xml` | Preview Suitelet script record and deployment |
| `src/Objects/customscript_ar_optin_mu.xml` | One-time custom mass update that opts in existing customers |
| `src/manifest.xml` | Declares the existing `custentity_2663_email_address_notif` field as a dependency |

## Install

Prerequisites: Node.js 18+, Java 17 (required by the SuiteCloud CLI), the CLI itself, and an account with the CRM,
Server SuiteScript and Subsidiaries features enabled (declared in `src/manifest.xml`; email templates need CRM):

```bash
npm install -g @oracle/suitecloud-cli
```

Then, in this folder:

```bash
npm install
```

```bash
npm test
```

```bash
suitecloud account:setup
```

`account:setup` links the project to the target account (this creates `project.json`, which is git-ignored).
Pick the account you intend to deploy to; nothing in the code references an account id.

```bash
suitecloud project:validate --server
```

```bash
suitecloud project:deploy
```

`project:deploy` runs `npm run build` first (see `suitecloud.config.js`), so the deployed JavaScript is always
compiled from the current TypeScript.

### Recipient fields (pre-existing, not defined here)

Recipients come from the customer field **Email Address for Notification** (`custentity_2663_email_address_notif`,
installed by the Electronic Bank Payments bundle), which may hold one address or a comma/semicolon-separated list. When
that field has no valid address, the customer's standard **Email** field is used instead. Neither field is defined in
this project: the notification field is declared as a dependency in `src/manifest.xml`, so SDF checks it exists in
the target account before deploying.

### First-run configuration

After the deploy, open the deployment (Customization > Scripting > Script Deployments > "AR Invoice Sender - daily (not scheduled yet)")
and fill in the parameters:

| Parameter | Id | Notes |
| --- | --- | --- |
| Default Sender Employee | `custscript_ar_default_sender` | Required. Author of customer emails when the subsidiary is not mapped, and of the digest. Must have an email address. |
| Sender Map | `custscript_ar_sender_map` | Optional JSON `{"<subsidiary id>": <employee id>}`, e.g. `{"1": 12, "3": 45}`. |
| Email Template Internal ID | `custscript_ar_email_template` | Required. Internal id of the "AR Open Invoice Reminder" template (Documents > Templates > Email Templates; the id is in the URL). |
| Digest Recipient Email | `custscript_ar_digest_recipient` | Internal address that receives the run digest. Empty = digest only in the execution log. |
| Dry Run | `custscript_ar_dry_run` | **Checked by default on deploy.** See below. |
| Send Daily | `custscript_ar_send_daily` | Ignore the cadence and send every open invoice every run. |
| Customer (only this customer) | `custscript_ar_customer` | Optional. Restricts the run to one customer. For the manual deployment; leave empty on the daily one. |
| Invoice IDs (manual send) | `custscript_ar_invoice_ids` | **Leave empty on every deployment.** The preview page sets it per run when it queues a manual send (see below). |

The deployment is created **Not Scheduled** for now, so nothing runs automatically after a deploy; sending is manual
from the preview page until the schedule is turned on. The Dry Run parameter defaults to checked. To enable the
automatic run, open the deployment, set Status to Scheduled with a Daily recurrence at 7:00 AM in your account's time
zone, and save (or restore the `<recurrence>` block in `customscript_ar_invoice_sender_mr.xml` and redeploy). Before
the first scheduled run, confirm that Dry Run is checked; uncheck it to go live.

Then open the third deployment, **AR Invoice Sender - selected invoices (queued by the Preview page)**
(`customdeploy_ar_invoice_sender_selected`), and fill in the same Default Sender Employee, Sender Map, Email Template
Internal ID and Digest Recipient. Its parameters are independent of the daily deployment. Leave Customer, Send Daily
and Invoice IDs empty on it. Its Dry Run value is ignored: a manual send from the preview page always emails for
real. Until this deployment is configured, **Send Selected** on the preview page queues a run that fails on start-up.

## Enabling a customer

1. Make sure **Auto-Send Open Invoices** (`custentity_ar_send_invoices`) is checked. It defaults to checked on
   customers created after deployment. For customers that existed before, run the custom mass update once:
   Lists > Mass Update > Mass Updates > Custom Updates > Customer > **AR Invoice Sender - Opt In Customers**,
   set the criteria (for example Inactive is false), preview, then perform. The checkbox is not offered on the
   General Updates field list, which is why the script exists.
2. Make sure **Email Address for Notification** (`custentity_2663_email_address_notif`) or the standard **Email** field
   contains at least one valid address. The notification field wins when it has a valid address; otherwise the Email
   field is used. Several addresses may be separated by commas or semicolons; `Name <address>` entries are accepted.
   Invalid entries are ignored and logged. A customer with the opt-in checked but no valid address in either field is
   skipped, logged as a warning and listed in the digest.

To pause a single invoice, check **Hold AR Emails** (`custbody_ar_hold`) on it.

## How the cadence works

Each run considers every open invoice (`transaction.type = 'CustInvc'`, status Open, unpaid amount > 0) of opted-in
customers, excluding invoices on hold and invoices already emailed today. For each invoice:

* **Day 0**: an invoice that has never been sent (`custbody_ar_last_sent` empty) is sent on the next run, whether or not it is due.
* **Past-due touches** at **1, 7, 14 and 30 days** after the due date. A touch is sent when the invoice has reached that
  many days overdue and the last send happened before that touch point. This "reached and not yet covered" rule means a
  run that did not happen (outage, script error) is caught up on the next run instead of being skipped.
* After 30 days overdue no further automatic emails are sent.
* **Send Daily** replaces the rules above: every open invoice goes out on every run (the on-hold and sent-today
  exclusions still apply).

Per customer, all qualifying invoices are rendered to PDF (`render.transaction`, PDF print mode) and sent in **one
email** with the invoices attached and a summary table (invoice #, date, due date, amount unpaid) in the body. If the
attachments would exceed 15 MB the invoices are split across several emails, numbered "(1 of n)". After each
successful send the script stamps `custbody_ar_last_sent` with today's date and increments `custbody_ar_send_count`
on every invoice in that email. The email is linked to the customer and to the first invoice of the email
(`relatedRecords`), so it appears on their Communication subtabs.

The sender is the employee mapped to the invoice's subsidiary in the Sender Map, or the Default Sender Employee.

### Email template

The body comes from the "AR Open Invoice Reminder" email template via `render.mergeEmail` (the customer record is passed
as the entity, so standard NetSuite merge fields keep working if you add them). The script then fills three tokens,
usable in both subject and body:

| Token | Value |
| --- | --- |
| `{{customerName}}` | Customer display name |
| `{{subsidiaryName}}` | Name of the invoice's subsidiary |
| `{{invoiceTable}}` | HTML summary table of the invoices attached to that email |

Edit the template in NetSuite or in `src/Objects/custemailtmpl_ar_invoice_reminder.template.html` and redeploy.

## Dry-run mode

With **Dry Run** checked (the default on a fresh deployment), the script:

* runs the full selection and cadence logic and renders the PDFs,
* writes an AUDIT log entry per email it *would* send (sender, recipients, subject, invoice numbers, attachment size),
* does **not** call `email.send` for customers and does **not** stamp the invoice fields,
* still emails the digest, with subject prefix `[DRY RUN]`, to the Digest Recipient.

To run it on demand, open the script deployment and use **Save and Execute** (or submit it from another script with
`task.MapReduceScriptTask`).

## Testing with one customer

A second deployment, **AR Invoice Sender - manual run (set Customer)** (`customdeploy_ar_invoice_sender_manual`), is
installed as Not Scheduled. Its parameters are independent of the daily deployment:

1. Open it, set **Customer (only this customer)**, fill in the sender, template and digest parameters, and uncheck
   **Dry Run** if you want a real email (leave it checked to only log).
2. **Save and Execute**. Only that customer's open invoices are considered; the cadence still applies (use **Send Daily**
   to force every open invoice), and a real send stamps the invoices as usual.
3. Check the digest and the execution log.

Never set the Customer parameter on the daily deployment: the scheduled run would then email only that customer.

## Preview page

The Suitelet **AR Invoice Sender Preview** (`customscript_ar_invoice_preview_sl`) shows every invoice the query returns,
with today's cadence verdict. Refreshing the page sends nothing and changes nothing. Open it from Customization >
Scripting > Script Deployments > "AR Invoice Sender Preview" (the deployment's URL), or bookmark that URL. It is
available to the Administrator, Accountant and A/R Clerk roles; edit `audslctrole` in the deployment XML to change
that. Because the page can also queue real emails (below), keep that role list to people who may send invoices.

Filters: customer, subsidiary, "Evaluate as Send Daily" (see the verdicts the Send Daily parameter would give) and
"Only invoices sending today". Columns: a selection checkbox, customer and invoice (linked), recipients as parsed and
validated (marked when the Email field fallback applies), subsidiary, dates, days overdue, amount unpaid, last sent,
send count, and **Sends Today?** with the reason (never sent, N days overdue, not overdue yet, touch already sent,
already sent today, customer skipped for no valid email address). Rows are green when they send today, grey when
they were already emailed today, and red when the customer has no valid email address. Totals are per currency. The
page shows at most 2,000 rows; narrow the filters beyond that. Unlike the scheduled run, the preview also lists
invoices already emailed today so they can be re-sent by hand; invoices on hold are never listed.

### Sending selected invoices by hand

Tick the invoices to send (the header checkbox selects or clears every selectable row) and click **Send Selected**.
After a confirmation dialog the page re-validates the selection against the live query and queues the AR Invoice
Sender Map/Reduce on the `customdeploy_ar_invoice_sender_selected` deployment with the Invoice IDs parameter set to
the selection. The Suitelet itself never renders PDFs or calls `email.send`: the Map/Reduce does the work with its
usual batching, governance handling, stamping and digest.

What a manual send does differently from the scheduled run:

* **The cadence is bypassed.** Every selected invoice is emailed, whatever its days overdue or last touch.
* **"Already sent today" is bypassed.** A selected invoice that went out this morning is sent again.
* **Everything else applies.** Invoices on hold and customers who opted out are not listed and cannot be selected; rows
  whose customer has no valid email address have no checkbox. The selection is checked again when you click the button,
  so an invoice paid, closed or put on hold since the page was loaded is reported as skipped and not sent.
* **Invoices are stamped as usual** (`custbody_ar_last_sent`, `custbody_ar_send_count`), so the cadence keeps working
  afterwards: the "reached and not yet covered" rule sends the next touch point when it is reached, exactly as if the
  scheduled run had made the send.
* **Dry Run does not apply.** A manual send always emails for real, whatever the Dry Run parameter on the deployment
  says: the confirmation dialog is the safeguard. (A false Dry Run override passed through `N/task` is dropped by
  NetSuite, which would otherwise leave the deployment's default-checked Dry Run in force, so the script ignores the
  parameter whenever Invoice IDs is set.) To rehearse, use the per-customer manual deployment with Dry Run checked.
* The **digest subject** reads "AR Invoice Sender (manual send)". Invoices a manual run cannot render within the
  governance limit are reported as "Not sent" rather than deferred, since no later run will pick them up; select them
  again.

The confirmation page lists what was queued and skipped, the task id, and links to the Map/Reduce Script Status page.
Each queued send is written to the Suitelet's execution log (AUDIT level) with the user and the invoice numbers.
Only one manual send can run at a time on the deployment; if one is still in progress the page reports
that the Map/Reduce could not be queued and asks you to retry.

## Digest

At the end of each run `summarize` emails the Digest Recipient (from the Default Sender Employee) with the customers
sent (recipients and invoice numbers, flagged when the fallback Email field was used), the customers skipped for a
missing email address, and every error (per-customer
failures, invoices deferred for governance, oversized PDFs, field-stamp failures, unhandled reduce errors). The same
summary is written to the execution log. Manual sends from the preview page produce the same digest, with
"(manual send)" in the subject.

## Development

```bash
npm run build
```

```bash
npm test
```

`tsconfig.json` targets ES2019 with AMD modules; `tsc` emits `define([...])` wrappers that NetSuite loads directly, and the
JSDoc header (`@NApiVersion 2.1`, `@NScriptType MapReduceScript`) is preserved at the top of the compiled file.
Types come from `@hitc/netsuite-types` (`N/*` path mapping in `tsconfig.json`).

Tests use `@oracle/suitecloud-unit-testing`: `N/*` imports resolve to Oracle's stubs, and `jest.mock('N/runtime')`
drives the script-parameter tests. The cadence, email parsing and batching modules are pure functions and are tested directly.

## Known limits

* **Transaction body fields apply to all sales transactions.** SDF has no "invoice only" switch for body fields, so
  `custbody_ar_*` are created with `bodysale=T` (invoice, sales order, cash sale, ...). Hide them on other custom forms if needed.
* **Email template id is a parameter.** NetSuite has no way to select an email template in a script parameter, so the
  internal id must be entered after deployment (`custscript_ar_email_template`).
* **Recipients:** `email.send` allows at most 10 recipients; extra addresses are dropped (logged).
* **Communication subtab:** an email can be related to only one transaction, so it is attached to the first invoice of
  each email plus the customer record.
* **Closed periods / locked invoices:** if `record.submitFields` cannot stamp an invoice (period locked without
  "allow non-G/L changes", workflow lock), the email has already gone out; the failure is reported in the digest and the
  invoice will be sent again on the next run until fixed or put on hold.
* **Governance:** reduce checks `getRemainingUsage()` before every PDF render. Invoices that do not fit in the
  remaining usage are deferred to the next run and listed in the digest. The deployment runs with buffer size 1 and
  concurrency 1.
* **Size:** attachments over 14.5 MB per email are split; a single PDF larger than that cannot be emailed and is reported.
* **"Sent today" and day counts** are computed in SuiteQL with `SYSDATE`, i.e. the database server's date. With a
  7:00 AM ET schedule this matches the calendar date in North America.
* **Manual sends share one deployment.** `customdeploy_ar_invoice_sender_selected` runs one instance at a time; a
  second **Send Selected** while one is still running is refused by NetSuite and reported on the page. The selection is
  passed as a script parameter override, so nothing is stored on the deployment between runs.
* **The Send Selected button is inline JavaScript** on the Suitelet form (no separate client script). It reads the
  ticked checkboxes, fills two hidden fields and submits the form; if NetSuite ever changes how form buttons are
  rendered, that is the place to look.
* **getInputData holds all open invoices in memory** (grouped by customer, no map stage). That is fine for tens of
  thousands of invoices; beyond that switch to a `{ type: 'suiteql' }` input with a map stage.
* `render.transactionFile` does not exist in `N/render`; the PDF is produced by `render.transaction({ entityId, printMode: PDF })`.
# dade-pump-ns-automated-billing-emails
