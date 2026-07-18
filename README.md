# Nmyt — Ops & Finance App

Invoicing, income/expense ledger, client pipeline (CRM), team & salaries, and
Profit & Loss / Balance Sheet reports — built with Next.js and Supabase, ready
to deploy on Vercel.

Unlike the earlier browser-only version, this one uses a real shared database
(Supabase/Postgres), so every signed-in team member sees the same invoices,
ledger, CRM, and team data — not just their own browser.

## What's inside

- **Dashboard** — income/expenses/net, broken down by wing, recent invoices
- **New Invoice / Edit / Duplicate** — line items, tax %, auto invoice numbering
- **Invoices** — search & filter by client, status, wing; CSV export; PDF download per invoice
- **Client Pipeline & CRM** — leads through Paid/Lost stages, weighted pipeline value
- **Team & Salaries** — team members/freelancers with payout rate; "Pay Now" logs straight to the ledger
- **Ledger** — income & expense log with running balance, search & filter, CSV export
- **Reports** — Profit & Loss (by period, with a category breakdown) and a simplified Balance Sheet, **each downloadable as its own PDF**
- **Settings** — company details, tax rate, bank details, JSON backup download
- **Sign-in required** — only people you've added in Supabase can see or touch any data

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick any name/region.
2. Once it's ready, open **SQL Editor → New query**, paste the entire contents
   of [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates
   all five tables (`settings`, `invoices`, `ledger`, `crm`, `team`) and locks
   them down with Row Level Security so **only signed-in users** can read or
   write anything.
3. Go to **Authentication → Providers** and confirm **Email** is enabled (it
   is by default). You can turn off "Confirm email" under
   **Authentication → Settings** if you don't want new users to click a
   confirmation link.
4. Go to **Authentication → Users → Add user** and create an account for
   yourself and each teammate (email + password). There's no public sign-up
   page in this app on purpose — access is invite-only, controlled entirely
   from this Supabase screen.
5. Go to **Project Settings → API**. Copy the **Project URL** and the
   **anon public key** — you'll need both in the next step.

## 2. Run it locally (optional but recommended first)

```bash
npm install
cp .env.local.example .env.local
# then edit .env.local and paste in your Project URL + anon key
npm run dev
```

Open `http://localhost:3000`, sign in with one of the users you created, and
click through the tabs to make sure everything looks right before deploying.

## 3. Deploy to Vercel

1. Push this project to a GitHub repository.
2. Go to [vercel.com](https://vercel.com) → **Add New → Project** → import
   that repository.
3. In **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL` → your Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → your Supabase anon public key
4. Click **Deploy**. Vercel will build and give you a live URL
   (e.g. `nmyt-app.vercel.app`) — share that with your team.

Every time you push a change to the repo, Vercel redeploys automatically.

---

## Security notes (read this)

- The **anon key** is meant to be public — it's safe to expose in the
  browser. What actually protects your data is the **Row Level Security**
  policies from `schema.sql`, which require a valid signed-in session for
  every single read/write. Without RLS, the anon key alone would let anyone
  read or write your tables.
- Add people by creating them in **Authentication → Users** in Supabase —
  there's no self-signup flow, so a stranger can't create their own account.
- Everyone who signs in currently shares the **same data** (one company-wide
  workspace) — there's no per-user data separation, which matches how a small
  team usually wants to work. If you later need role-based permissions (e.g.
  freelancers who can only see their own tasks), that would need additional
  RLS policies and is a reasonable next step, not something built in here.

## About the Balance Sheet

The Balance Sheet on the Reports tab is a simplified, real-time snapshot
built only from what this app tracks (cash from the ledger, plus unpaid
"Sent" invoices as receivables). It does not track loans, physical assets, or
vendor payables, and isn't a substitute for a formal, audited balance sheet —
use a real accountant for compliance or filing purposes.

## Project structure

```
app/
  layout.js         Root layout, loads global styles
  globals.css        All styling (dark/gold theme)
  page.js             The entire app (auth gate + all tabs)
lib/
  supabaseClient.js   Supabase client setup
supabase/
  schema.sql          Run this once in Supabase's SQL Editor
.env.local.example    Copy to .env.local and fill in your keys
```
