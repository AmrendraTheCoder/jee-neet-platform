-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0011_economy.sql
-- Regenerate with: pnpm db:sync
--
-- The source file wraps itself in begin/commit. That wrapper is removed here
-- because Prisma runs each migration inside its own transaction, and a nested
-- commit would close it early.

-- 0011_economy.sql
--
-- Coins, streaks, plans, subscriptions and payment events.
--
-- Invariant 9 is the whole point of this file: coins are earn-only and never
-- purchasable. There is no enum value for a purchase-origin credit, so a
-- purchase-derived coin is not merely forbidden by policy -- it is not
-- expressible (FR-RWD-01, AC-RWD-01).
--
-- This is not a product preference. The Promotion and Regulation of Online
-- Gaming Act 2025 captures "other stakes" including coins equivalent or
-- convertible to money, skill is irrelevant to that analysis, and exposure
-- includes personal officer liability. FR-RWD-01 and FR-RWD-05 together are
-- what keep the platform outside that Act, outside the app stores' virtual-
-- currency expiry rules, and outside the GST actionable-claim analysis.
--
-- Requirements: FR-RWD-01..07, FR-RWD-12, FR-COM-01..09, NFR-SCL-09, AC-RWD-01, AC-RWD-03.


-- Read this list adversarially: there is no PURCHASE, no TOP_UP, no BONUS_SKU,
-- no PROMOTIONAL_GRANT tied to a payment, and no ADMIN_GRANT that a commerce
-- webhook could reach. Adding one is not a feature -- it changes the platform's
-- legal position (FR-RWD-01).
create type public.coin_earn_reason as enum (
  'DAILY_TARGET_COMPLETED',
  'SRS_SESSION_COMPLETED',
  'PRACTICE_SET_COMPLETED',
  'MOCK_COMPLETED',
  'STREAK_MILESTONE',
  'WEEKLY_GOAL_MET',
  'ERROR_REPORT_UPHELD',
  'PROFILE_COMPLETED',
  -- FR-SCR-16: compensating top-up after a rescore. Top-up only; there is no
  -- clawback reason on the spend side either, because clawback is a worse trust
  -- event than the original scoring error.
  'RESCORE_COMPENSATION'
);

comment on type public.coin_earn_reason is
  'The complete whitelist of ways a coin can come into existence (FR-RWD-01, FR-RWD-04). AC-RWD-01 asserts there is no code path and no enum value by which a coin balance can increase as a result of a payment.';

create type public.coin_spend_reason as enum (
  'CUSTOM_TEST_SLOT',
  'ANALYTICS_DEEP_DIVE',
  'COSMETIC_UNLOCK',
  'PRACTICE_SET_UNLOCK'
);

comment on type public.coin_spend_reason is
  'Coin sinks are in-app utility only (FR-RWD-02). No cash, no vouchers, no third-party goods, and nothing here converts back out.';

create type public.storefront as enum ('WEB', 'APPLE_APP_STORE', 'GOOGLE_PLAY');

create type public.subscription_status as enum (
  'ACTIVE',
  'GRACE',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'REVOKED'
);

create type public.payment_event_kind as enum (
  'PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'REFUND',
  'REVOCATION',
  'CHARGEBACK'
);

/* ------------------------------------------------------------------ *
 * Earn rules and the mint cap (FR-RWD-04)
 * ------------------------------------------------------------------ */

create table public.earn_rule (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  earn_reason public.coin_earn_reason not null,
  coins integer not null check (coins > 0),
  daily_cap integer check (daily_cap is null or daily_cap > 0),
  lifetime_cap integer check (lifetime_cap is null or lifetime_cap > 0),
  enabled boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (org_id, earn_reason)
);

comment on table public.earn_rule is
  'A whitelist with per-action values and caps (FR-RWD-04). Configuration, not code, so the rewards module can be tuned or switched off without a release (FR-RWD-12).';

create index earn_rule_org_idx on public.earn_rule (org_id);

create table public.coin_mint_cap (
  org_id uuid not null references public.org (id) on delete restrict,
  day date not null,
  minted integer not null default 0 check (minted >= 0),
  -- The global daily mint cap bounds farm damage even when abuse goes
  -- undetected. Per-user caps do not: an attacker with a thousand accounts
  -- respects every per-user cap simultaneously.
  cap integer not null default 100000 check (cap > 0),
  primary key (org_id, day)
);

comment on table public.coin_mint_cap is
  'Global daily mint ceiling (FR-RWD-04). Updated atomically inside the ledger trigger, never read-modify-write in application code (NFR-SCL-09).';

/* ------------------------------------------------------------------ *
 * Ledger (FR-RWD-03, NFR-SCL-09)
 * ------------------------------------------------------------------ */

create table public.coin_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  delta integer not null check (delta <> 0),
  earn_reason public.coin_earn_reason,
  spend_reason public.coin_spend_reason,
  -- FR-RWD-03: natural idempotency. ref_type plus ref_id is the business
  -- identity of the grant -- 'attempt' plus the attempt id, 'srs_session' plus
  -- the session id -- so a retried grant collides instead of double-crediting.
  ref_type text not null,
  ref_id uuid not null,
  note text,
  created_at timestamptz not null default now(),

  unique (user_id, ref_type, ref_id),
  constraint coin_ledger_one_reason
    check ((earn_reason is not null) <> (spend_reason is not null)),
  -- Sign follows reason. An earn cannot be negative and a spend cannot be
  -- positive, so a mis-signed row is a constraint violation rather than a
  -- quiet balance corruption discovered by the nightly reconciler.
  constraint coin_ledger_sign_matches_reason
    check ((earn_reason is not null and delta > 0) or (spend_reason is not null and delta < 0))
);

comment on table public.coin_ledger is
  'Append-only coin ledger (FR-RWD-03). The unique key on (user_id, ref_type, ref_id) is the idempotency guarantee: a retried grant raises a unique violation instead of minting twice. AC-RWD-03 reconciles this against coin_balance nightly and alarms on any drift.';

create index coin_ledger_org_user_idx on public.coin_ledger (org_id, user_id, created_at desc);
create index coin_ledger_day_idx on public.coin_ledger (org_id, created_at);

create trigger coin_ledger_append_only
  before update or delete on public.coin_ledger
  for each row execute function app.tg_append_only();

create table public.coin_balance (
  user_id uuid primary key references public.profile (user_id) on delete restrict,
  org_id uuid not null references public.org (id) on delete restrict,
  balance integer not null default 0 check (balance >= 0),
  lifetime_earned integer not null default 0 check (lifetime_earned >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.coin_balance is
  'Materialised balance, maintained atomically by the ledger trigger (NFR-SCL-09). A read-modify-write from application code loses concurrent grants; the CHECK on balance turns an over-spend into an error rather than a negative balance.';

create index coin_balance_org_idx on public.coin_balance (org_id);

create function app.tg_coin_ledger_apply() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_minted integer;
begin
  if new.delta > 0 then
    -- Global daily mint cap, applied atomically. INSERT ... ON CONFLICT DO
    -- UPDATE makes the read and the increment one statement, so two concurrent
    -- grants cannot both observe headroom that only one of them has.
    insert into public.coin_mint_cap as c (org_id, day, minted)
    values (new.org_id, current_date, new.delta)
    on conflict (org_id, day) do update
      set minted = c.minted + excluded.minted
    returning c.minted, c.cap into v_minted, v_cap;

    if v_minted > v_cap then
      raise exception
        'global daily mint cap reached for org % on % (% of %) (FR-RWD-04)',
        new.org_id, current_date, v_minted, v_cap
        using errcode = '54000';
    end if;
  end if;

  insert into public.coin_balance as b (user_id, org_id, balance, lifetime_earned, updated_at)
  values (new.user_id, new.org_id, new.delta, greatest(new.delta, 0), now())
  on conflict (user_id) do update
    set balance = b.balance + excluded.balance,
        lifetime_earned = b.lifetime_earned + excluded.lifetime_earned,
        updated_at = now();

  return new;
end;
$$;

create trigger coin_ledger_apply
  after insert on public.coin_ledger
  for each row execute function app.tg_coin_ledger_apply();

/* ------------------------------------------------------------------ *
 * Streaks (FR-RWD-06, FR-RWD-07, FR-RWD-13)
 * ------------------------------------------------------------------ */

create table public.streak (
  user_id uuid primary key references public.profile (user_id) on delete cascade,
  org_id uuid not null references public.org (id) on delete restrict,
  current_length integer not null default 0 check (current_length >= 0),
  longest_length integer not null default 0 check (longest_length >= 0),
  -- FR-RWD-06: earnable by a small daily action, never by completing a
  -- full-length mock. A streak that requires three hours is a streak that
  -- punishes a student for having a school day.
  last_qualifying_on date,
  freezes_available smallint not null default 2 check (freezes_available >= 0),
  freezes_used_total integer not null default 0,
  -- Schedulable rest days, and effort-based repair. Never paid repair: paying
  -- to fix a streak is the dark pattern this product refuses (FR-RWD-07).
  rest_days jsonb not null default '[]'::jsonb,
  -- FR-RWD-13: auto-suspension around a real exam, driven by the admin exam
  -- calendar. AC-RWD-02: a student who writes NEET on 3 May and does not open
  -- the app until 6 May loses nothing and receives no re-engagement push.
  suspended_until date,
  suspension_reason text,
  updated_at timestamptz not null default now()
);

comment on table public.streak is
  'Streak state with generous, bounded forgiveness (FR-RWD-07) and calendar-driven suspension (FR-RWD-13). Gamification stays in low-stakes practice and never appears on a mock result screen (FR-RWD-11).';

create index streak_org_idx on public.streak (org_id);
create index streak_suspension_idx on public.streak (suspended_until) where suspended_until is not null;

/* ------------------------------------------------------------------ *
 * Commerce (FR-COM-01..09)
 * ------------------------------------------------------------------ */

create table public.plan (
  code text primary key,
  org_id uuid not null references public.org (id) on delete restrict,
  name text not null,
  -- FR-COM-04: list price is computed net-revenue-backwards. Commission, GST
  -- and processor fees are modelled explicitly so the number is defensible
  -- rather than guessed, and so a store change is a repricing and not a loss.
  list_price_minor integer not null check (list_price_minor > 0),
  currency text not null default 'INR',
  gst_rate_bp integer not null default 1800,
  store_commission_bp integer not null default 0,
  processor_fee_bp integer not null default 0,
  storefront public.storefront not null,
  -- FR-RWD-05: coins are NEVER bundled into a purchasable SKU. There is no
  -- included_coins column, and adding one would defeat FR-RWD-01 by the back
  -- door.
  period_days integer not null check (period_days > 0),
  refund_window_days integer not null default 7 check (refund_window_days >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.plan is
  'A single paid tier per storefront (FR-COM-01). Multiple tiers are prohibited: they produce entitlement bugs and "I paid and it is not available" support load, which is the category failure this product is positioned against.';

create index plan_org_idx on public.plan (org_id);

create table public.subscription (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  -- FR-COM-07: where the account holder is a minor, the contracting and paying
  -- party is the verified guardian. Recorded, because the invoice and the
  -- entitlement are then legitimately in different names.
  payer_user_id uuid references public.profile (user_id) on delete restrict,
  guardian_link_id uuid references public.guardian_link (id) on delete restrict,
  plan_code text not null references public.plan (code) on delete restrict,
  storefront public.storefront not null,
  status public.subscription_status not null default 'ACTIVE',
  started_at timestamptz not null default now(),
  current_period_end timestamptz not null,
  -- FR-COM-03, FR-COM-08: cancellation is one tap, takes effect without
  -- contacting support, and there is no pre-ticked auto-renew. auto_renew
  -- defaults to the value the store reports and is never assumed true.
  auto_renew boolean not null default false,
  cancelled_at timestamptz,
  -- FR-COM-05: entitlement is honoured from this row, never from a
  -- client-supplied receipt.
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscription is
  'The platform own record of entitlement (FR-COM-05). A client-supplied receipt is evidence for a webhook, never an authorisation. A store-initiated refund or revocation flips status here and entitlement follows (FR-COM-06).';

create unique index subscription_active_uidx
  on public.subscription (user_id)
  where status in ('ACTIVE', 'GRACE');
create index subscription_org_user_idx on public.subscription (org_id, user_id);
create index subscription_period_idx on public.subscription (current_period_end)
  where status in ('ACTIVE', 'GRACE');

create trigger subscription_touch before update on public.subscription
  for each row execute function app.tg_touch_updated_at();

create table public.payment_event (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.org (id) on delete restrict,
  user_id uuid not null references public.profile (user_id) on delete restrict,
  subscription_id uuid references public.subscription (id) on delete restrict,
  kind public.payment_event_kind not null,
  storefront public.storefront not null,
  amount_minor integer not null,
  currency text not null default 'INR',
  gst_amount_minor integer,
  -- FR-COM-09: place of supply from the declared state, for correct GST
  -- classification. Stored on the event because it is the fact at the time of
  -- the transaction, not the student's current address.
  place_of_supply_state text,
  external_event_id text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (storefront, external_event_id)
);

comment on table public.payment_event is
  'Append-only record of store and processor events. Note what it cannot do: there is no foreign key, trigger or enum value connecting this table to coin_ledger, which is the structural form of AC-RWD-01.';

create index payment_event_org_user_idx on public.payment_event (org_id, user_id, occurred_at desc);
create index payment_event_subscription_idx on public.payment_event (subscription_id);

create trigger payment_event_append_only
  before update or delete on public.payment_event
  for each row execute function app.tg_append_only();
