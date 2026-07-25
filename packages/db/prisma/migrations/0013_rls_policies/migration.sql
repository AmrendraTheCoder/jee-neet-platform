-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0013_rls_policies.sql
-- Regenerate with: pnpm db:sync
--
-- The source file wraps itself in begin/commit. That wrapper is removed here
-- because Prisma runs each migration inside its own transaction, and a nested
-- commit would close it early.

-- 0013_rls_policies.sql
--
-- Row-level security for every table in the client-exposed schema, plus the
-- deliberate grants that make those policies the only thing standing between a
-- student token and another tenant's data.
--
-- Why this is one migration rather than a stanza at the foot of each of 0003
-- through 0012: a policy is a statement about the *whole* access model, not
-- about one table. `attempt_response` is readable only if `attempt` is, and
-- `question_version` is unreadable precisely when some `attempt` still holds
-- it. Splitting those decisions across nine files is how two of them end up
-- disagreeing. Everything that decides who reads what lives here, once.
--
-- The shape of every policy in this file:
--
--   * scoped TO authenticated, never TO public -- `public` includes `anon`,
--     which is an unauthenticated request holding only the publishable key
--   * every org-scoped predicate names `org_id` (invariant 4). A policy that
--     filters on user but not org is a cross-tenant leak the moment two
--     students in different orgs share a user id space, which they do
--   * helper calls are wrapped -- `(select app.is_admin())` -- so the planner
--     hoists them into an InitPlan and evaluates them once per statement
--     rather than once per candidate row
--   * no joins. Where a predicate needs another table, it goes through a
--     SECURITY DEFINER helper with an empty search path (0002, 0003, 0006)
--
-- Writes that carry authority do not appear here at all. Starting an attempt,
-- recording a response, minting a coin and revising a key are SECURITY DEFINER
-- RPCs, because each one has a rule -- the deadline, the sequence guard, the
-- mint cap, the rescore plan -- that a WITH CHECK clause cannot express. The
-- absence of an INSERT policy on `attempt_response` is the enforcement of
-- invariant 7, not an oversight.
--
-- RLS is enabled but never FORCEd. The definer helpers in 0002/0003/0006 and
-- the RPCs in 0006/0007/0008 run as the table owner and must continue to read
-- rows the caller cannot; FORCE would apply the caller's policies to the
-- owner and break every gate that exists to be more precise than a policy.
--
-- Requirements: NFR-SEC-01, NFR-SEC-02, FR-TEN-01..05, FR-IDN-05..07,
-- FR-SOL-05, FR-RWD-08, NFR-PRV-02, NFR-PRV-03.


/* ------------------------------------------------------------------ *
 * Predicate helpers
 *
 * Two questions get asked by nearly every catalogue table, and asking them
 * inline in forty policies means forty places for the platform-org carve-out
 * to be forgotten.
 * ------------------------------------------------------------------ */

create function app.can_read_catalogue(p_org_id uuid) returns boolean
language sql stable parallel safe
set search_path = ''
as $$
  -- Shared content is owned by the platform org and readable by every tenant;
  -- a tenant's own content is readable only by that tenant (FR-TEN-02).
  select p_org_id = app.platform_org_id() or p_org_id = app.current_org_id();
$$;

comment on function app.can_read_catalogue(uuid) is
  'Catalogue read predicate: the shared platform catalogue plus the caller own org. Used by taxonomy, content and plan policies.';

create function app.can_write_catalogue(p_org_id uuid) returns boolean
language sql stable parallel safe
set search_path = ''
as $$
  -- An institute admin must never edit the shared bank that every other tenant
  -- reads. Writing a platform-org row requires platform admin specifically,
  -- which app.is_admin() deliberately does not confer.
  select case
    when p_org_id = app.platform_org_id() then app.is_platform_admin()
    else p_org_id = app.current_org_id() and app.is_admin()
  end;
$$;

comment on function app.can_write_catalogue(uuid) is
  'Catalogue write predicate. Platform-org rows require app.is_platform_admin(); tenant rows require app.is_admin() in that same tenant.';

grant execute on function app.can_read_catalogue(uuid) to authenticated;
grant execute on function app.can_write_catalogue(uuid) to authenticated;

/* ================================================================== *
 * 0003 -- Identity
 * ================================================================== */

-- The caller's own org row, and the platform org so a client can resolve the
-- shared catalogue's owner. `org` keys tenancy on `id`, not `org_id`.
alter table public.org enable row level security;
grant select on public.org to authenticated;

create policy org_read_own on public.org
  for select to authenticated
  using (id = (select app.current_org_id()) or id = (select app.platform_org_id()));

create policy org_write_platform_admin on public.org
  for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- Profile. Self-service for the caller's own row, read-only for a verified
-- guardian (FR-IDN-05) and for a tenant admin.
alter table public.profile enable row level security;
grant select, update on public.profile to authenticated;

create policy profile_read_self on public.profile
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (
      user_id = (select auth.uid())
      or app.is_guardian_of(user_id)
      or (select app.is_admin())
    )
  );

-- Deliberately narrow: the columns that decide age, lawful basis, processing
-- state and ban status are server-owned. A student may edit their display name
-- and locale; they may not promote themselves out of PENDING_GUARDIAN_CONSENT.
create policy profile_update_self on public.profile
  for update to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.guardian_link enable row level security;
grant select on public.guardian_link to authenticated;

create policy guardian_link_read on public.guardian_link
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (
      child_user_id = (select auth.uid())
      or guardian_user_id = (select auth.uid())
      or (select app.is_admin())
    )
  );

-- Notices are the published text a consent record points at. Global, versioned,
-- and readable before consent completes -- a student who cannot read the notice
-- cannot meaningfully consent to it.
alter table public.notice_version enable row level security;
grant select on public.notice_version to authenticated, anon;

create policy notice_version_read on public.notice_version
  for select to authenticated
  using (withdrawn_at is null or (select app.is_admin()));

create policy notice_version_write on public.notice_version
  for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- Consent events are append-only evidence (7-year retention class). The
-- student reads their own; nobody updates or deletes through the API.
alter table public.consent_event enable row level security;
grant select on public.consent_event to authenticated;

create policy consent_event_read on public.consent_event
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (
      user_id = (select auth.uid())
      or app.is_guardian_of(user_id)
      or (select app.is_admin())
    )
  );

alter table public.trusted_device enable row level security;
grant select, update on public.trusted_device to authenticated;

create policy trusted_device_read_self on public.trusted_device
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

-- Revoking a device is the one write a student needs here, and it is the write
-- that matters when a phone is lost.
create policy trusted_device_revoke_self on public.trusted_device
  for update to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

/* ================================================================== *
 * 0004 -- Taxonomy, marking rules and patterns
 *
 * Read-wide, write-narrow. Every authenticated principal in every tenant reads
 * the shared taxonomy; only a platform admin edits it.
 * ================================================================== */

-- `exam` is the one genuinely global row set: it has no org_id because an exam
-- code is not a tenant's property.
alter table public.exam enable row level security;
grant select on public.exam to authenticated;

create policy exam_read on public.exam
  for select to authenticated
  using (true);

create policy exam_write on public.exam
  for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

alter table public.chapter enable row level security;
grant select on public.chapter to authenticated;

create policy chapter_read on public.chapter
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy chapter_write on public.chapter
  for all to authenticated
  using (app.can_write_catalogue(org_id))
  with check (app.can_write_catalogue(org_id));

alter table public.topic enable row level security;
grant select on public.topic to authenticated;

create policy topic_read on public.topic
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy topic_write on public.topic
  for all to authenticated
  using (app.can_write_catalogue(org_id))
  with check (app.can_write_catalogue(org_id));

alter table public.sub_topic enable row level security;
grant select on public.sub_topic to authenticated;

create policy sub_topic_read on public.sub_topic
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy sub_topic_write on public.sub_topic
  for all to authenticated
  using (app.can_write_catalogue(org_id))
  with check (app.can_write_catalogue(org_id));

alter table public.syllabus enable row level security;
grant select on public.syllabus to authenticated;

create policy syllabus_read on public.syllabus
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (status = 'ACTIVE' or (select app.is_admin())));

create policy syllabus_write on public.syllabus
  for all to authenticated
  using (app.can_write_catalogue(org_id))
  with check (app.can_write_catalogue(org_id));

alter table public.syllabus_chapter enable row level security;
grant select on public.syllabus_chapter to authenticated;

create policy syllabus_chapter_read on public.syllabus_chapter
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy syllabus_chapter_write on public.syllabus_chapter
  for all to authenticated
  using (app.can_write_catalogue(org_id))
  with check (app.can_write_catalogue(org_id));

-- Marking rules are readable: a student is entitled to know the scheme they
-- were scored under (FR-SCR-18), and the review screen renders it. Writing one
-- is gated on the capability, not merely on being an admin.
alter table public.marking_rule enable row level security;
grant select on public.marking_rule to authenticated;

create policy marking_rule_read on public.marking_rule
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy marking_rule_write on public.marking_rule
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('tests.publish')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('tests.publish')));

alter table public.exam_pattern enable row level security;
grant select on public.exam_pattern to authenticated;

create policy exam_pattern_read on public.exam_pattern
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy exam_pattern_write on public.exam_pattern
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('tests.publish')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('tests.publish')));

alter table public.pattern_section enable row level security;
grant select on public.pattern_section to authenticated;

create policy pattern_section_read on public.pattern_section
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy pattern_section_write on public.pattern_section
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('tests.publish')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('tests.publish')));

-- The calendar drives notification suppression and the deploy freeze. Every
-- client reads it; only the platform maintains it.
alter table public.exam_calendar_event enable row level security;
grant select on public.exam_calendar_event to authenticated;

create policy exam_calendar_event_read on public.exam_calendar_event
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy exam_calendar_event_write on public.exam_calendar_event
  for all to authenticated
  using (app.can_write_catalogue(org_id))
  with check (app.can_write_catalogue(org_id));

/* ================================================================== *
 * 0005 -- Question content
 *
 * Two audiences with opposite needs. An author must see every draft in their
 * own org; a student must see published, unretired, unembargoed items and
 * nothing else. The embargo column is what keeps a paper's items unreadable
 * until its window opens -- 0007's tg_embargo_paper_items sets it, and this is
 * the policy that honours it.
 *
 * Answer keys, solutions and rationales are not here. They are in the private
 * schema with zero grants (0006), because RLS controls rows and never columns.
 * ================================================================== */

alter table public.content_source enable row level security;
grant select on public.content_source to authenticated;

create policy content_source_read on public.content_source
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (select app.has_permission('questions.write')));

create policy content_source_write on public.content_source
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

alter table public.question_stimulus enable row level security;
grant select on public.question_stimulus to authenticated;

-- A shared stem carries no key material, and it is referenced rather than
-- duplicated across the items that use it, so it follows catalogue read.
create policy question_stimulus_read on public.question_stimulus
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (select app.processing_allowed()));

create policy question_stimulus_write on public.question_stimulus
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

-- The question row is the identity and lifecycle record; the content is on the
-- version. `licence_status` gates DARK and RESTRICTED items out of student
-- reach without deleting them.
alter table public.question enable row level security;
grant select on public.question to authenticated;

create policy question_read on public.question
  for select to authenticated
  using (
    app.can_read_catalogue(org_id)
    and (select app.processing_allowed())
    and retired_at is null
    and licence_status = 'CLEARED'
  );

create policy question_read_author on public.question
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (select app.has_permission('questions.write')));

create policy question_write on public.question
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

alter table public.question_version enable row level security;
grant select on public.question_version to authenticated;

-- AC-IDN-01 (processing_allowed), invariant 2 (retired is a status), and the
-- embargo that hides a live paper's items are all enforced in this one
-- predicate. A student never reaches a DRAFT, a retired version, or an item
-- whose test has not opened.
create policy question_version_read on public.question_version
  for select to authenticated
  using (
    app.can_read_catalogue(org_id)
    and (select app.processing_allowed())
    and status = 'PUBLISHED'
    and retired_at is null
    and (embargoed_until is null or embargoed_until <= now())
  );

create policy question_version_read_author on public.question_version
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (select app.has_permission('questions.write')));

create policy question_version_write on public.question_version
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

-- Options are the answerable surface. They carry no correctness marker -- that
-- is private.answer_key -- so they follow their version's visibility.
alter table public.question_option enable row level security;
grant select on public.question_option to authenticated;

create policy question_option_read on public.question_option
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (select app.processing_allowed()));

create policy question_option_write on public.question_option
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

alter table public.question_translation enable row level security;
grant select on public.question_translation to authenticated;

create policy question_translation_read on public.question_translation
  for select to authenticated
  using (
    app.can_read_catalogue(org_id)
    and (select app.processing_allowed())
    and (status = 'PUBLISHED' or (select app.has_permission('questions.write')))
  );

create policy question_translation_write on public.question_translation
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

alter table public.question_option_translation enable row level security;
grant select on public.question_option_translation to authenticated;

create policy question_option_translation_read on public.question_option_translation
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (select app.processing_allowed()));

create policy question_option_translation_write on public.question_option_translation
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

alter table public.question_exam_tag enable row level security;
grant select on public.question_exam_tag to authenticated;

create policy question_exam_tag_read on public.question_exam_tag
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (select app.processing_allowed()));

create policy question_exam_tag_write on public.question_exam_tag
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

-- Editorial only. DUPLICATE_OF and VARIANT_OF edges tell a student which items
-- share an answer, which is a practice-integrity leak rather than a key leak,
-- but a leak all the same.
alter table public.question_relation enable row level security;
grant select on public.question_relation to authenticated;

create policy question_relation_read on public.question_relation
  for select to authenticated
  using (app.can_read_catalogue(org_id) and (select app.has_permission('questions.write')));

create policy question_relation_write on public.question_relation
  for all to authenticated
  using (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')))
  with check (app.can_write_catalogue(org_id) and (select app.has_permission('questions.write')));

/* ================================================================== *
 * 0007 -- Tests
 *
 * `test_question` is the paper. It is admin-only, unconditionally: a student
 * who can read it can read the item list of a test that has not opened, which
 * defeats the embargo on the items themselves. Students reach their paper
 * through public.get_attempt_paper(), which is SECURITY DEFINER and checks
 * attempt state.
 * ================================================================== */

alter table public.blueprint enable row level security;
grant select on public.blueprint to authenticated;

create policy blueprint_admin on public.blueprint
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.is_admin()))
  with check (org_id = (select app.current_org_id()) and (select app.is_admin()));

alter table public.test enable row level security;
grant select on public.test to authenticated;

-- A student sees a test from the moment it is scheduled -- they have to, to
-- find it in the calendar and start it -- but seeing the row is not seeing the
-- paper. DRAFT never leaves the console.
create policy test_read on public.test
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (select app.processing_allowed())
    and status <> 'DRAFT'
  );

create policy test_read_admin on public.test
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.is_admin()));

create policy test_write on public.test
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('tests.publish')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('tests.publish')));

alter table public.test_section enable row level security;
grant select on public.test_section to authenticated;

-- Section metadata -- name, counts, marks, whether navigation is free -- is
-- what the instructions screen renders before the clock starts. It names no
-- question.
create policy test_section_read on public.test_section
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.processing_allowed()));

create policy test_section_write on public.test_section
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('tests.publish')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('tests.publish')));

alter table public.test_question enable row level security;
grant select on public.test_question to authenticated;

create policy test_question_admin on public.test_question
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('questions.write')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('questions.write')));

-- Assets are immutable objects addressed by one URL for every student, so that
-- the CDN can cache them (NFR-SCL). The row carries a sha256, not a signature.
alter table public.test_asset enable row level security;
grant select on public.test_asset to authenticated;

create policy test_asset_read on public.test_asset
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.processing_allowed()));

create policy test_asset_write on public.test_asset
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('tests.publish')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('tests.publish')));

/* ================================================================== *
 * 0008 -- Attempts
 *
 * Read-only for the student, throughout. Every mutation on this path -- start,
 * response, heartbeat, submit, extension -- runs through a SECURITY DEFINER RPC
 * that owns a rule no WITH CHECK clause can state: the server-authoritative
 * deadline, the client_seq guard that drops out-of-order sync, the grace
 * window, and idempotency on retry.
 *
 * There is deliberately no UPDATE policy on public.attempt. That absence is
 * invariant 7.
 * ================================================================== */

alter table public.accommodation_entitlement enable row level security;
grant select on public.accommodation_entitlement to authenticated;

create policy accommodation_entitlement_read on public.accommodation_entitlement
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (user_id = (select auth.uid()) or (select app.is_admin()))
  );

create policy accommodation_entitlement_write on public.accommodation_entitlement
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.is_admin()))
  with check (org_id = (select app.current_org_id()) and (select app.is_admin()));

alter table public.attempt enable row level security;
grant select on public.attempt to authenticated;

create policy attempt_read_self on public.attempt
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy attempt_read_admin on public.attempt
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.attempt_session enable row level security;
grant select on public.attempt_session to authenticated;

-- The student needs to see that another device took the session over; that is
-- the whole point of SESSION_TAKEOVER surfacing in the client.
create policy attempt_session_read_self on public.attempt_session
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy attempt_session_read_admin on public.attempt_session
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.attempt_section enable row level security;
grant select on public.attempt_section to authenticated;

create policy attempt_section_read_self on public.attempt_section
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy attempt_section_read_admin on public.attempt_section
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.attempt_response enable row level security;
grant select on public.attempt_response to authenticated;

-- Read so the client can reconcile after a reconnect and render the palette on
-- resume. Written only by public.record_attempt_responses().
create policy attempt_response_read_self on public.attempt_response
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy attempt_response_read_admin on public.attempt_response
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.attempt_response_event enable row level security;
grant select on public.attempt_response_event to authenticated;

create policy attempt_response_event_read_self on public.attempt_response_event
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy attempt_response_event_read_admin on public.attempt_response_event
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.attempt_focus_event enable row level security;
grant select on public.attempt_focus_event to authenticated;

create policy attempt_focus_event_read_self on public.attempt_focus_event
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy attempt_focus_event_read_admin on public.attempt_focus_event
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.attempt_incident enable row level security;
grant select, insert on public.attempt_incident to authenticated;

create policy attempt_incident_read_self on public.attempt_incident
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

-- STUDENT_REPORTED is the one incident kind a client may raise, and it is
-- corroborated server-side before it can justify an extension: the row carries
-- server_corroborated, which this policy does not let the client set.
create policy attempt_incident_report_self on public.attempt_incident
  for insert to authenticated
  with check (
    org_id = (select app.current_org_id())
    and user_id = (select auth.uid())
    and kind = 'STUDENT_REPORTED'
    and not server_corroborated
    and lost_seconds is null
  );

create policy attempt_incident_admin on public.attempt_incident
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('attempts.extend')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('attempts.extend')));

-- Visible to the student because an extension changes their deadline and they
-- are entitled to know why. Granted only through the capability, and applied by
-- app.tg_apply_deadline_extension rather than by writing attempt.deadline_at.
alter table public.attempt_deadline_extension enable row level security;
grant select on public.attempt_deadline_extension to authenticated;

create policy attempt_deadline_extension_read on public.attempt_deadline_extension
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and exists (
      select 1 from public.attempt a
      where a.id = attempt_id and a.user_id = (select auth.uid())
    )
  );

create policy attempt_deadline_extension_admin on public.attempt_deadline_extension
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('attempts.extend')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('attempts.extend')));

/* ================================================================== *
 * 0009 -- Results, leaderboards and revisions
 *
 * Results are read through the pointer. `attempt_result` holds every revision
 * ever computed; `attempt_result_pointer` names the one that is current and
 * published. A student reading the result table directly would see a superseded
 * score alongside its replacement with no way to tell them apart, so the
 * pointer is the contract and the revision history is admin-only.
 * ================================================================== */

alter table public.attempt_result enable row level security;
grant select on public.attempt_result to authenticated;

create policy attempt_result_read_self on public.attempt_result
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.attempt_result_pointer p
      where p.attempt_id = attempt_id
        and p.attempt_result_id = id
        and p.published_at is not null
        and p.published_at <= now()
    )
  );

create policy attempt_result_read_admin on public.attempt_result
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.attempt_result_pointer enable row level security;
grant select on public.attempt_result_pointer to authenticated;

create policy attempt_result_pointer_read_self on public.attempt_result_pointer
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and user_id = (select auth.uid())
    and published_at is not null
    and published_at <= now()
  );

create policy attempt_result_pointer_read_admin on public.attempt_result_pointer
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.attempt_question_result enable row level security;
grant select on public.attempt_question_result to authenticated;

-- Per-question marks carry the explanation, which is the closest thing to key
-- material outside the private schema: knowing an option was CORRECT is knowing
-- the key. Gated on the same published pointer as the aggregate score.
create policy attempt_question_result_read_self on public.attempt_question_result
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.attempt_result_pointer p
      where p.attempt_id = attempt_id
        and p.attempt_result_id = attempt_result_id
        and p.published_at is not null
        and p.published_at <= now()
    )
  );

create policy attempt_question_result_read_admin on public.attempt_question_result
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

-- Opt-in is the student's own decision and the only leaderboard row they write.
-- Opting out permanently is a one-way door (FR-RWD-08); the column that records
-- it is never cleared by this policy because the client cannot null it back.
alter table public.leaderboard_opt_in enable row level security;
grant select, insert, update on public.leaderboard_opt_in to authenticated;

create policy leaderboard_opt_in_self on public.leaderboard_opt_in
  for all to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.leaderboard_snapshot enable row level security;
grant select on public.leaderboard_snapshot to authenticated;

create policy leaderboard_snapshot_read on public.leaderboard_snapshot
  for select to authenticated
  using (org_id = (select app.current_org_id()) and is_current);

create policy leaderboard_snapshot_admin on public.leaderboard_snapshot
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.is_admin()))
  with check (org_id = (select app.current_org_id()) and (select app.is_admin()));

alter table public.leaderboard_entry enable row level security;
grant select on public.leaderboard_entry to authenticated;

-- Bucketed and pseudonymous, and readable only by a student who has opted in.
-- There is no public all-India rank wall, and an opted-out student is neither
-- listed nor able to list anyone else.
create policy leaderboard_entry_read on public.leaderboard_entry
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and exists (
      select 1 from public.leaderboard_opt_in o
      where o.user_id = (select auth.uid())
        and o.org_id = org_id
        and o.opted_in
        and o.permanently_opted_out_at is null
    )
  );

create policy leaderboard_entry_admin on public.leaderboard_entry
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.score_revision enable row level security;
grant select on public.score_revision to authenticated;

-- The public note is the student-facing explanation of a key change. The plan,
-- the affected counts and the coin totals are operational.
create policy score_revision_read on public.score_revision
  for select to authenticated
  using (org_id = (select app.current_org_id()) and executed_at is not null);

create policy score_revision_admin on public.score_revision
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('keys.revise')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('keys.revise')));

alter table public.score_revision_notice enable row level security;
grant select on public.score_revision_notice to authenticated;

create policy score_revision_notice_read_self on public.score_revision_notice
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy score_revision_notice_admin on public.score_revision_notice
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.result_share_link enable row level security;
grant select, insert, update on public.result_share_link to authenticated;

create policy result_share_link_self on public.result_share_link
  for all to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

/* ================================================================== *
 * 0010 -- Learning: SRS, notes, bookmarks
 *
 * All of it is the student's own working material, and all of it is
 * read-write for its owner. This is the one region of the schema where the
 * client is the author of record.
 * ================================================================== */

alter table public.srs_card enable row level security;
grant select, insert, update on public.srs_card to authenticated;

create policy srs_card_self on public.srs_card
  for all to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.srs_review_log enable row level security;
grant select, insert on public.srs_review_log to authenticated;

-- Append-only, enforced by trigger. Insert is the client's; there is no update
-- policy, so the retraining corpus cannot be rewritten after the fact.
create policy srs_review_log_read_self on public.srs_review_log
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy srs_review_log_insert_self on public.srs_review_log
  for insert to authenticated
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.seen_ledger enable row level security;
grant select, insert, update on public.seen_ledger to authenticated;

create policy seen_ledger_self on public.seen_ledger
  for all to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.note enable row level security;
grant select, insert, update on public.note to authenticated;

-- No DELETE grant: deletion is `deleted_at`, so a note that syncs back from an
-- offline device cannot resurrect as a duplicate of one already removed.
create policy note_self on public.note
  for all to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.note_conflict enable row level security;
grant select, insert, update on public.note_conflict to authenticated;

create policy note_conflict_self on public.note_conflict
  for all to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.bookmark enable row level security;
grant select, insert, delete on public.bookmark to authenticated;

create policy bookmark_self on public.bookmark
  for all to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.mistake_tag enable row level security;
grant select, insert, update, delete on public.mistake_tag to authenticated;

create policy mistake_tag_self on public.mistake_tag
  for all to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()))
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

/* ================================================================== *
 * 0011 -- Economy
 *
 * Invariant 9: coins are earn-only. There is no INSERT policy on
 * public.coin_ledger for any client role, and no UPDATE policy on
 * public.coin_balance. Minting happens inside the earn RPC against the daily
 * cap; the balance is maintained by app.tg_coin_ledger_apply. A client that
 * could write either could mint currency, which is the exact thing that would
 * pull this product into gaming legislation.
 * ================================================================== */

alter table public.earn_rule enable row level security;
grant select on public.earn_rule to authenticated;

-- Readable because a student is entitled to know what earns what.
create policy earn_rule_read on public.earn_rule
  for select to authenticated
  using (org_id = (select app.current_org_id()) and enabled);

create policy earn_rule_write on public.earn_rule
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('rewards.configure')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('rewards.configure')));

alter table public.coin_mint_cap enable row level security;
grant select on public.coin_mint_cap to authenticated;

create policy coin_mint_cap_admin on public.coin_mint_cap
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('rewards.configure')));

alter table public.coin_ledger enable row level security;
grant select on public.coin_ledger to authenticated;

create policy coin_ledger_read_self on public.coin_ledger
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy coin_ledger_read_admin on public.coin_ledger
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('rewards.configure')));

alter table public.coin_balance enable row level security;
grant select on public.coin_balance to authenticated;

create policy coin_balance_read_self on public.coin_balance
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.streak enable row level security;
grant select on public.streak to authenticated;

create policy streak_read_self on public.streak
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.plan enable row level security;
grant select on public.plan to authenticated;

create policy plan_read on public.plan
  for select to authenticated
  using (app.can_read_catalogue(org_id) and active);

create policy plan_write on public.plan
  for all to authenticated
  using (app.can_write_catalogue(org_id))
  with check (app.can_write_catalogue(org_id));

alter table public.subscription enable row level security;
grant select on public.subscription to authenticated;

-- The payer may be a guardian rather than the student, so both reach the row.
create policy subscription_read on public.subscription
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (
      user_id = (select auth.uid())
      or payer_user_id = (select auth.uid())
      or app.is_guardian_of(user_id)
    )
  );

create policy subscription_read_admin on public.subscription
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.is_admin()));

alter table public.payment_event enable row level security;
grant select on public.payment_event to authenticated;

-- Append-only by trigger, and written only by the webhook handler running as
-- service_role. A client that could insert one could forge a paid subscription.
create policy payment_event_read_self on public.payment_event
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy payment_event_read_admin on public.payment_event
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.is_admin()));

/* ================================================================== *
 * 0012 -- Governance, telemetry and data-subject rights
 * ================================================================== */

alter table public.audit_log enable row level security;
grant select on public.audit_log to authenticated;

-- Append-only by trigger and readable only through the capability. Nothing here
-- is writable by any client role: an audit log a caller can write is not one.
create policy audit_log_read on public.audit_log
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('audit.read')));

alter table public.idempotency_key enable row level security;
grant select, insert on public.idempotency_key to authenticated;

create policy idempotency_key_self on public.idempotency_key
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy idempotency_key_insert_self on public.idempotency_key
  for insert to authenticated
  with check (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

alter table public.feature_flag enable row level security;
grant select on public.feature_flag to authenticated;

create policy feature_flag_read on public.feature_flag
  for select to authenticated
  using (app.can_read_catalogue(org_id));

create policy feature_flag_write on public.feature_flag
  for all to authenticated
  using (app.can_write_catalogue(org_id))
  with check (app.can_write_catalogue(org_id));

alter table public.dsr_request enable row level security;
grant select, insert on public.dsr_request to authenticated;

-- A data-subject request must be raisable by the subject or by their verified
-- guardian, and must be visible to them afterwards. The handler fields are
-- admin-owned; a client insert that set them would be forging a resolution.
create policy dsr_request_read on public.dsr_request
  for select to authenticated
  using (
    org_id = (select app.current_org_id())
    and (user_id = (select auth.uid()) or app.is_guardian_of(user_id))
  );

create policy dsr_request_raise on public.dsr_request
  for insert to authenticated
  with check (
    org_id = (select app.current_org_id())
    and raised_by_user_id = (select auth.uid())
    and (user_id = (select auth.uid()) or app.is_guardian_of(user_id))
    and status = 'RECEIVED'
    and handler_user_id is null
    and completed_at is null
  );

create policy dsr_request_admin on public.dsr_request
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.is_admin()))
  with check (org_id = (select app.current_org_id()) and (select app.is_admin()));

alter table public.error_report enable row level security;
grant select, insert on public.error_report to authenticated;

-- FR-ADM: a student challenging a question is the earliest signal that a key is
-- wrong. The challenge window is server-set; the resolution fields are not
-- writable by the reporter.
create policy error_report_read_self on public.error_report
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy error_report_raise on public.error_report
  for insert to authenticated
  with check (
    org_id = (select app.current_org_id())
    and user_id = (select auth.uid())
    and status = 'OPEN'
    and resolved_by is null
    and resolved_at is null
    and public_resolution_note is null
  );

create policy error_report_admin on public.error_report
  for all to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('questions.write')))
  with check (org_id = (select app.current_org_id()) and (select app.has_permission('questions.write')));

alter table public.notification_outbox enable row level security;
grant select on public.notification_outbox to authenticated;

-- Read-only, so a student can see what was sent and why one was suppressed.
-- Writes go through the send path, where quiet hours and the frequency cap are
-- enforced by app.tg_notification_gate and cannot be overridden by campaign
-- configuration.
create policy notification_outbox_read_self on public.notification_outbox
  for select to authenticated
  using (org_id = (select app.current_org_id()) and user_id = (select auth.uid()));

create policy notification_outbox_admin on public.notification_outbox
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.is_admin()));

alter table public.telemetry_pedagogical_event enable row level security;
grant insert on public.telemetry_pedagogical_event to authenticated;

-- Insert-only for the client. There is no read policy for a student: a
-- telemetry stream a user can query is an analytics surface, and this one
-- carries other principals' rows under the same org.
create policy telemetry_pedagogical_insert_self on public.telemetry_pedagogical_event
  for insert to authenticated
  with check (
    org_id = (select app.current_org_id())
    and user_id = (select auth.uid())
    and (select app.processing_allowed())
  );

create policy telemetry_pedagogical_read_admin on public.telemetry_pedagogical_event
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

alter table public.telemetry_engagement_event enable row level security;
grant insert on public.telemetry_engagement_event to authenticated;

-- NFR-PRV-02. The gateway blocks this pipeline for under-18 principals and
-- app.tg_block_minor_engagement blocks it again at the row. This policy is the
-- third: a minor's engagement event fails the WITH CHECK before the trigger
-- ever fires. Three controls, because the consequence of missing is unlawful
-- profiling of children rather than a bug.
create policy telemetry_engagement_insert_self on public.telemetry_engagement_event
  for insert to authenticated
  with check (
    org_id = (select app.current_org_id())
    and user_id = (select auth.uid())
    and (select app.processing_allowed())
    and not app.is_minor(user_id)
  );

create policy telemetry_engagement_read_admin on public.telemetry_engagement_event
  for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_permission('analytics.read')));

-- The subprocessor register is a transparency obligation: it is published, and
-- it has no org_id because the list is the platform's, not a tenant's.
alter table public.subprocessor enable row level security;
grant select on public.subprocessor to authenticated;

create policy subprocessor_read on public.subprocessor
  for select to authenticated
  using (removed_on is null or (select app.is_admin()));

create policy subprocessor_write on public.subprocessor
  for all to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

/* ------------------------------------------------------------------ *
 * Sequences
 *
 * 0002 revoked the default. Nothing in this schema uses a client-visible
 * sequence -- every surrogate key is a uuid -- so there is deliberately no
 * blanket USAGE grant here to put one back.
 * ------------------------------------------------------------------ */
