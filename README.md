# Fanyou

School-team directory and fan engagement app. The school directory remains locally saved; the suggestion/profile feature uses authenticated server APIs backed by a dedicated Supabase project.

## Memberships

| Membership | Monthly | Annual | Features |
| --- | --- | --- | --- |
| Free Fan | $0 | $0 | 10 submitted suggestions per UTC calendar month |
| Unlimited Fan | $10 | $99 | Unlimited suggestions, subject to anti-spam controls |
| Player / Coach Premier | $10 | $99 | Verified Player / Coach profile, unlimited suggestions, OpenAI screening of incoming suggestions and outgoing replies |

Player and Coach basic profiles are free and require manual identity verification. A Premier subscription never grants identity verification. Basic-profile messages await a human moderator. Premier messages use `omni-moderation-latest`, strict category thresholds, and baseline profanity/contact/threat checks. If OpenAI is unavailable, messages are held for review and cannot be automatically delivered. Text screening cannot prove identity or guarantee that every bad message is detected.

Fans only see their own suggestions and approved replies. A verified Player or Coach only receives approved suggestions addressed to their profile and can reply only to those suggestions. There are no public message threads or private contact details. All client content is rendered as text. Existing basketball chat, subscription buttons, rewards, and schema viewer remain a separate simulated demo and do not grant Suggestion Box access.

## Activate accounts and suggestions

1. Use the dedicated **fanyou.app** Supabase project. Run `database/setup.sql` once in its SQL editor. Do not apply it to another app’s project. It creates server-only tables, RLS, atomic quota functions, and billing lifecycle functions.
2. Enable email/password signup with email confirmation. Set the Auth Site URL and allowed redirect URL to your deployed Fanyou URL. Configure an email provider for reliable signup delivery.
3. Set `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the hosting environment. Public and private keys have separate purposes; only the backend receives the service key. Store secrets as sensitive environment variables. Never commit populated `.env` files.
4. Create the administrator’s account and confirm its email. From a trusted Supabase administrator session, set `app_metadata.fanyou_admin = true` using the Supabase Auth Admin API. Never put this in `user_metadata`. Admin API routes revalidate the user with Supabase before checking the role. Moderators should approve profile identities independently of payment and screen basic-profile suggestions and replies before delivery. The UI includes a review queue and audit trail.
5. Set `OPENAI_API_KEY` on the backend. The client never gets it. Premier content remains pending if moderation fails or is unavailable.
6. Run the verification checks below, deploy the Node API and public assets, then verify signup, confirmed login, profile review, suggestion submission, and replies against this project.

## Activate billing

Keep `BILLING_ENABLED=false` until the complete webhook path has been tested in a separate Stripe sandbox.

Create two Stripe Products: **Fanyou Unlimited Fan** and **Fanyou Player / Coach Premier**. Each product needs a USD recurring monthly Price for **1000 cents** and yearly Price for **9900 cents**. Set the four IDs shown in `.env.example`. The backend checks amount, currency, recurrence, allowed plan, and verified profile requirements before Checkout.

Use a restricted Stripe API key with the minimum permissions for Customers, Prices, Checkout Sessions, Subscriptions, Billing Portal, Invoices, Invoice Payments, and Charges. Set `STRIPE_SECRET_KEY` in the sensitive server environment, and configure Stripe Billing Portal for self-service cancellation/payment management. Disable plan switching in Billing Portal for this release; use it for cancellation and payment management. Tier changes need the authenticated checkout checks and correctly assigned subscription metadata.

Register `https://YOUR_FANYOU_DOMAIN/api/webhook` and set `STRIPE_WEBHOOK_SECRET`. Subscribe to:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
- `invoice.paid`, `invoice.payment_failed`
- `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`

Webhook signatures are verified from the raw request body. Ownership maps through the stored Stripe Customer ID. The handler retrieves current subscription state rather than trusting the redirect or an old event snapshot. Payment must be confirmed, the subscription active, and its paid period unexpired. Failed payments, cancellation, collection pauses, and expiry remove unlimited access. Full refunds, disputes, and fraud warnings create persistent billing holds that ordinary webhook replays cannot remove. Investigate a hold before clearing it from the trusted database; partial refunds retain access. Subscription snapshots use timestamps and database locks to avoid an earlier sync overwriting a later one.

Verify valid/invalid signatures, initial payment, asynchronous payment, renewal, failed payment, period-end cancellation, full refund, and delayed event replay in a sandbox. Configure any required tax registrations and Stripe Tax separately; automatic tax is not enabled by this integration. Then configure live Prices and keys, verify the live endpoint, and set `BILLING_ENABLED=true`.

## Development and checks

Requires Node 22+.

```sh
npm ci
npm test
npm run build
# Populate local secrets privately, then start with env support:
node --env-file=.env server.js
```

`npm test` runs backend moderation, subscription, request validation, and embedded PostgreSQL tests for quotas, paid access, ownership, and access isolation. These checks do not replace live Stripe/Supabase/OpenAI end-to-end testing. Build output includes only the public HTML/JavaScript; database scripts and backend secrets are not served as static assets. `vercel.json` configures the Node API, static output, and headers. `api/index.js` preserves raw webhook bodies.

## Activation state

Code alone does not activate payments, OpenAI, or an account database. Without the required Supabase configuration, the UI displays an activation notice and disables signup/posting/payment buttons. Checkout stays closed until both explicit enablement and signing-secret configuration are present. This prevents collecting payments for an inactive suggestion/profile service.

## Optional interaction points and fan stars

Apply `database/points-stars.sql` once after the base database setup. Players and Coaches can enable points from their signed-in profile. The public table shows only participating, approved, identity-verified profiles. Each new approved reply to another fan's suggestion earns **10 points**, whether approved by OpenAI or a human. Points start after opting in; there is no automatic backfill. Turning participation off hides the public row and stops new awards while retaining already earned points. Duplicate approvals cannot award points twice, and rejecting a reply removes its award. Only approved parent suggestions/replies contribute to totals.

An active paid **Fan** may optionally award **1–5 stars** to an approved reply to their own approved suggestion. One rating is stored per reply; editing it replaces the prior rating. Other fans, self-interactions, free/expired/restricted memberships, and unapproved replies cannot award stars. Existing historical ratings remain after a membership expires, but new ratings/edits require active payment. Average stars and rating count appear on verified profiles and in the optional points table. Star ratings and interaction points are separate and do not grant paid access.

The server and database enforce eligibility. Points are issued by a database trigger, not a client button. New tables have RLS and no browser grants; score aggregates use a server-only security-invoker view.
