-- GENERATED FILE. DO NOT EDIT.
--
-- Source: packages/db/migrations/0100_scoring_functions.sql
-- Regenerate with: pnpm db:sync
--
-- The source file manages no transaction of its own; Prisma supplies one.

-- =====================================================================
-- 0100_scoring_functions.sql
--
-- The scoring primitives, ported from packages/domain/src/scoring/*.ts.
--
-- FR-SCR-01 makes the DATABASE authoritative for scoring in production.
-- The TypeScript engine in packages/domain is the reference implementation
-- and the test oracle. The two must agree exactly, so this file is a
-- deliberate line-by-line port rather than an independent implementation --
-- including the student-facing explanation strings, which are compared in
-- test/04_scoring_golden.sql.
--
-- ---------------------------------------------------------------------
-- SCHEMA ASSUMPTIONS
-- ---------------------------------------------------------------------
-- This file depends on nothing but core PostgreSQL. Later files in this
-- series (0102 onward) read the application schema created by migrations
-- 00xx. Every such coupling is listed at the top of the file that has it.
--
-- ---------------------------------------------------------------------
-- SECURITY POSTURE (invariant 3, NFR-SEC-02)
-- ---------------------------------------------------------------------
-- Every function here is SECURITY DEFINER with SET search_path = ''. That
-- combination is only safe if every identifier is schema-qualified, which
-- is why even `pg_catalog` operators' function forms are spelled out where
-- ambiguity is possible. EXECUTE is revoked from PUBLIC and re-granted
-- narrowly in 0106_grants.sql -- nothing in this file is callable by a
-- student.
-- =====================================================================

create schema if not exists private;
comment on schema private is
  'Non-exposed schema. Zero grants to anon/authenticated (invariant 3). '
  'Answer keys, solutions, role assignments, licence evidence and scoring '
  'internals live here and are reachable only through state-checking RPCs.';

-- ---------------------------------------------------------------------
-- Numeric normalisation (FR-SCR-05, EC-DATA-07)
-- ---------------------------------------------------------------------
-- The failure this prevents: a student on a Hindi or Tamil device locale
-- types a correct answer, the keypad emits non-ASCII decimal digits, the
-- cast to numeric fails, and the answer scores zero with no way for the
-- student to discover why. NEET is offered in 13 languages; this is not a
-- hypothetical.
--
-- NFKC does NOT fold Indic digits to ASCII -- a common and expensive
-- assumption. The digit table below is therefore explicit.

create or replace function private.nonascii_decimal_digits()
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- Base code point of every Unicode decimal digit block a candidate in
  -- India may plausibly produce, mirroring DIGIT_BASES in
  -- packages/domain/src/scoring/numeric.ts. Order is base-ascending then
  -- digit-ascending, so the translation target is repeat('0123456789', 12).
  select string_agg(pg_catalog.chr(b.base + d.d), '' order by b.base, d.d)
  from (values
      (1632),   -- U+0660 Arabic-Indic
      (1776),   -- U+06F0 Extended Arabic-Indic
      (2406),   -- U+0966 Devanagari
      (2534),   -- U+09E6 Bengali / Assamese
      (2662),   -- U+0A66 Gurmukhi
      (2790),   -- U+0AE6 Gujarati
      (2918),   -- U+0B66 Odia
      (3046),   -- U+0BE6 Tamil
      (3174),   -- U+0C66 Telugu
      (3302),   -- U+0CE6 Kannada
      (3430),   -- U+0D66 Malayalam
      (65296)   -- U+FF10 Fullwidth
    ) as b(base),
    pg_catalog.generate_series(0, 9) as d(d)
$$;

comment on function private.nonascii_decimal_digits() is
  'The 120 non-ASCII decimal digit code points folded by normalize_numeric. '
  'Fullwidth is included even though NFKC already folds it, so the table '
  'remains correct if the NFKC step is ever reordered.';

create or replace function public.normalize_numeric(p_input text)
returns text
language plpgsql
immutable
parallel safe
security definer
set search_path = ''
as $$
declare
  v text;
begin
  -- FR-SCR-05: never throws. NULL means "this is not a number", which is a
  -- wrong answer, not an unattempted one -- the distinction is made by the
  -- caller, not here.
  if p_input is null then
    return null;
  end if;

  -- NORMALIZE is SQL-standard syntax, not an ordinary function call: the form
  -- argument is a keyword and the construct cannot be schema-qualified. It is
  -- safe under `search_path = ''` regardless, because pg_catalog is always
  -- implicitly searched first when it is not named explicitly.
  v := normalize(p_input, nfkc);

  -- Every dash-like code point a keyboard, autocorrect or paste can produce.
  v := pg_catalog.translate(
         v,
         U&'\2212\2010\2011\2012\2013\2014\2015\FE58\FE63\FF0D',
         '----------');

  v := pg_catalog.translate(v, U&'\FF0B\FE62', '++');

  -- Decimal separators folded to '.'. Note that the COMMA is deliberately
  -- absent here: in Indian numeric convention the period is the decimal
  -- separator universally and the comma is a lakh-grouping separator, so
  -- treating comma as decimal would misread 1,50,000 catastrophically.
  v := pg_catalog.translate(v, U&'\066B\00B7\FF0E', '...');

  v := pg_catalog.translate(
         v,
         private.nonascii_decimal_digits(),
         pg_catalog.repeat('0123456789', 12));

  -- Characters removed outright: grouping separators and the apostrophe
  -- forms used as separators in some locales. translate() deletes source
  -- characters that have no counterpart in the target string.
  v := pg_catalog.translate(v, U&'\002C\066C\2009\202F\00A0\2007\0027\2019\005F', '');

  v := pg_catalog.regexp_replace(v, '\s', '', 'g');

  -- The accepted grammar is exactly the one packages/domain parseDecimal
  -- accepts: optional sign, digits with an optional fractional part (or a
  -- bare fractional part), and an optional decimal exponent of at most four
  -- digits. It rejects '1/2', 'NaN', 'Infinity' and bare signs. The four
  -- digit cap on the exponent is not cosmetic -- it is what stops '1e999999'
  -- from allocating an unbounded numeric.
  if v !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]{1,4})?$' then
    return null;
  end if;

  return v;
end;
$$;

comment on function public.normalize_numeric(text) is
  'FR-SCR-05 / EC-DATA-07. Folds a raw numeric response to an ASCII canonical '
  'form: NFKC, minus and plus variants, decimal separators, 12 non-ASCII digit '
  'blocks, grouping separators and whitespace. Returns NULL when the result is '
  'not a valid numeric literal. Never throws.';

-- ---------------------------------------------------------------------
-- Numeric grading (FR-SCR-06)
-- ---------------------------------------------------------------------
-- NUMERIC throughout, never float8. IEEE-754 cannot represent 0.1 exactly,
-- so a tolerance comparison in double precision marks correct answers wrong
-- at the tolerance boundary -- silently, and it presents as poor student
-- performance rather than as a bug.

create or replace function public.grade_numeric(
  p_student text,
  p_key_value numeric,
  p_spec jsonb
)
returns text
language plpgsql
immutable
parallel safe
security definer
set search_path = ''
as $$
declare
  v_canonical text;
  v_student   numeric;
  v_kind      text;
  v_decimals  integer;
  v_mode      text;
  v_tol       numeric;
begin
  -- Mirrors gradeNumeric: a blank response is INCORRECT here. The
  -- UNATTEMPTED classification is made one level up, in score_question,
  -- because it depends on the marking rule and not on the value.
  if p_student is null or pg_catalog.btrim(p_student) = '' then
    return 'INCORRECT';
  end if;

  v_canonical := public.normalize_numeric(p_student);
  if v_canonical is null then
    return 'UNPARSEABLE';
  end if;

  v_student := v_canonical::numeric;

  if p_spec is null then
    raise exception
      'numeric marking rule has no numeric spec; a numeric question cannot be graded without one'
      using errcode = 'invalid_parameter_value';
  end if;

  v_kind := p_spec ->> 'kind';

  if v_kind = 'EXACT_INTEGER' then
    -- Integer-answer questions: the student may legitimately type "12.00",
    -- so compare at integer precision. But a genuinely fractional answer to
    -- an integer question is wrong, not silently truncated into correctness.
    if v_student <> pg_catalog.trunc(v_student) then
      return 'INCORRECT';
    end if;
    return case
      when pg_catalog.trunc(v_student) = pg_catalog.trunc(p_key_value) then 'CORRECT'
      else 'INCORRECT'
    end;

  elsif v_kind = 'TOLERANCE' then
    v_tol := (p_spec ->> 'toleranceAbs')::numeric;
    return case
      when pg_catalog.abs(v_student - p_key_value) <= v_tol then 'CORRECT'
      else 'INCORRECT'
    end;

  elsif v_kind = 'ROUNDED' then
    v_decimals := (p_spec ->> 'decimals')::integer;
    v_mode := p_spec ->> 'mode';
    -- TRUNCATE and HALF_UP are both here because examining bodies differ and
    -- the difference is worth marks: JEE Advanced specifies truncation to two
    -- decimals, so 2.999 is 2.99 and not 3.00. Getting this wrong changes the
    -- verdict on every answer whose next digit is 5 or more.
    if v_mode = 'TRUNCATE' then
      return case
        when pg_catalog.trunc(v_student, v_decimals) = pg_catalog.trunc(p_key_value, v_decimals)
          then 'CORRECT'
        else 'INCORRECT'
      end;
    elsif v_mode = 'HALF_UP' then
      -- pg_catalog.round(numeric, int) rounds half away from zero, which is
      -- exactly roundDecimal(..., 'HALF_UP') in the reference engine.
      return case
        when pg_catalog.round(v_student, v_decimals) = pg_catalog.round(p_key_value, v_decimals)
          then 'CORRECT'
        else 'INCORRECT'
      end;
    else
      raise exception 'unknown numeric rounding mode %', v_mode
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  raise exception 'unknown numeric spec kind %', v_kind
    using errcode = 'invalid_parameter_value';
end;
$$;

comment on function public.grade_numeric(text, numeric, jsonb) is
  'FR-SCR-06. EXACT_INTEGER | TOLERANCE | ROUNDED(HALF_UP|TRUNCATE), all in '
  'NUMERIC. String equality is prohibited and float8 is never used.';

-- ---------------------------------------------------------------------
-- Rendering helpers for the student-facing explanation (FR-SCR-18)
-- ---------------------------------------------------------------------
-- The explanation strings are compared against the reference engine's
-- output, so numbers must render the way JavaScript renders them: 4 not
-- 4.0, -1 not -1.00.

create or replace function private.js_number_text(v numeric)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when v is null then null
    when v = pg_catalog.trunc(v) then pg_catalog.trunc(v)::bigint::text
    else pg_catalog.rtrim(pg_catalog.rtrim(v::text, '0'), '.')
  end
$$;

-- The proportional formula 4 x correct/total is quoted back to the student
-- precisely so they can see it is NOT what was applied. It circulates widely,
-- including on major coaching sites, and a student who has read it there will
-- otherwise believe the platform under-marked them.
create or replace function private.format_proportional(
  p_full numeric,
  p_selected_correct integer,
  p_total_correct integer
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when (p_full * p_selected_correct / p_total_correct)
       = pg_catalog.trunc(p_full * p_selected_correct / p_total_correct)
      then pg_catalog.trunc(p_full * p_selected_correct / p_total_correct)::bigint::text
    else pg_catalog.to_char(
           pg_catalog.round(p_full * p_selected_correct / p_total_correct, 2),
           'FM9999999990.00')
  end
$$;

-- ---------------------------------------------------------------------
-- score_question (FR-SCR-02, FR-PAT-04, FR-SCR-18)
-- ---------------------------------------------------------------------
-- PURITY CONTRACT, identical to the reference engine. This function must
-- never read the clock, any configuration table, or any column other than
-- the ones in its arguments. In particular it is structurally blind to
-- marked_for_review, visited, time_spent_ms and client_seq (FR-ATT-03) --
-- they are not parameters, so they cannot leak in.
--
-- `p_marking` is the MarkingRule jsonb as authored on the
-- (test_section, question) join, never on the item (FR-PAT-04).

create or replace function public.score_question(
  p_marking      jsonb,
  p_selected     uuid[],
  p_numeric_raw  text,
  p_key_options  uuid[],
  p_key_numeric  numeric,
  p_resolution   text
)
returns jsonb
language plpgsql
immutable
parallel safe
security definer
set search_path = ''
as $$
declare
  v_type              text := p_marking ->> 'questionType';
  v_correct_txt       text := p_marking ->> 'correct';
  v_incorrect_txt     text := p_marking ->> 'incorrect';
  v_correct           numeric := (p_marking ->> 'correct')::numeric;
  v_incorrect         numeric := (p_marking ->> 'incorrect')::numeric;
  v_unattempted       numeric := (p_marking ->> 'unattempted')::numeric;
  v_attempted         boolean;
  v_selected          uuid[];
  v_key               uuid[];
  v_selected_correct  integer;
  v_selected_wrong    integer;
  v_total_correct     integer;
  v_partial           jsonb;
  v_award             numeric;
  v_award_txt         text;
  v_penalty           numeric;
  v_penalty_txt       text;
  v_verdict           text;
  v_spec              jsonb;
begin
  if v_type is null then
    raise exception 'marking rule has no questionType: %', p_marking
      using errcode = 'invalid_parameter_value';
  end if;

  -- ---- Key resolutions applied by a rescore (FR-SCR-13) -----------------
  -- Evaluated first because they override the authored key entirely.

  if p_resolution = 'DROPPED' then
    -- Credit everyone who appeared, attempted or not.
    return pg_catalog.jsonb_build_object(
      'marks', v_correct,
      'status', 'DROPPED',
      'explanation',
        'This question was dropped. All candidates were awarded ' || v_correct_txt || ' marks.');
  end if;

  v_attempted := case
    when v_type in ('NUMERIC_INTEGER', 'NUMERIC_DECIMAL')
      then p_numeric_raw is not null and pg_catalog.btrim(p_numeric_raw) <> ''
    else coalesce(pg_catalog.array_length(p_selected, 1), 0) > 0
  end;

  if p_resolution = 'ALL_CORRECT' then
    if not v_attempted then
      return pg_catalog.jsonb_build_object(
        'marks', v_unattempted,
        'status', 'UNATTEMPTED',
        'explanation',
          'This question was credited to all candidates who attempted it. You did not attempt it.');
    end if;
    return pg_catalog.jsonb_build_object(
      'marks', v_correct,
      'status', 'CORRECT',
      'explanation',
        'This question was found ambiguous. All candidates who attempted it were awarded '
        || v_correct_txt || ' marks.');
  end if;

  -- ---- Normal grading ---------------------------------------------------

  if v_type in ('MCQ_SINGLE', 'ASSERTION_REASON', 'MATCHING_LIST') then

    if not v_attempted then
      return pg_catalog.jsonb_build_object(
        'marks', v_unattempted, 'status', 'UNATTEMPTED', 'explanation', 'Not answered.');
    end if;

    -- A single-choice question carrying more than one selection is malformed
    -- input, not a partially correct answer. The player prevents it; a
    -- scripted client does not, so the engine must have an opinion.
    if pg_catalog.array_length(p_selected, 1) > 1 then
      return pg_catalog.jsonb_build_object(
        'marks', v_incorrect,
        'status', 'INCORRECT',
        'explanation',
          'More than one option was recorded for a single-answer question. Scored as incorrect ('
          || v_incorrect_txt || ').');
    end if;

    if p_selected[1] = any (coalesce(p_key_options, '{}'::uuid[])) then
      -- Under a MULTI_KEY resolution the key carries more than one acceptable
      -- option; selecting any of them earns full marks.
      if p_resolution = 'MULTI_KEY' and pg_catalog.array_length(p_key_options, 1) > 1 then
        return pg_catalog.jsonb_build_object(
          'marks', v_correct,
          'status', 'CORRECT',
          'explanation',
            'Correct. The answer key for this question was revised to accept '
            || pg_catalog.array_length(p_key_options, 1)::text
            || ' options; your response is one of them. Awarded ' || v_correct_txt || '.');
      end if;
      return pg_catalog.jsonb_build_object(
        'marks', v_correct,
        'status', 'CORRECT',
        'explanation', 'Correct. Awarded ' || v_correct_txt || '.');
    end if;

    return pg_catalog.jsonb_build_object(
      'marks', v_incorrect,
      'status', 'INCORRECT',
      'explanation', 'Incorrect. ' || v_incorrect_txt || ' applied.');

  elsif v_type = 'MCQ_MULTI' then

    if not v_attempted then
      return pg_catalog.jsonb_build_object(
        'marks', v_unattempted, 'status', 'UNATTEMPTED', 'explanation', 'Not answered.');
    end if;

    -- De-duplicate defensively on both sides: a retried sync could in
    -- principle deliver a repeated option id, and it must not inflate the
    -- partial-credit count.
    select pg_catalog.array_agg(distinct s) into v_selected
    from pg_catalog.unnest(p_selected) as s;
    select pg_catalog.array_agg(distinct k) into v_key
    from pg_catalog.unnest(coalesce(p_key_options, '{}'::uuid[])) as k;

    v_total_correct := coalesce(pg_catalog.array_length(v_key, 1), 0);

    select
      pg_catalog.count(*) filter (where s = any (coalesce(v_key, '{}'::uuid[]))),
      pg_catalog.count(*) filter (where not (s = any (coalesce(v_key, '{}'::uuid[]))))
      into v_selected_correct, v_selected_wrong
    from pg_catalog.unnest(v_selected) as s;

    v_partial := p_marking -> 'partial';
    if v_partial is null then
      -- FR-PAT-08 makes this unreachable through the publish gate. If it is
      -- reached, defaulting to all-or-nothing would silently under-score every
      -- candidate on a partial-credit paper, so refuse instead.
      raise exception
        'multi-correct marking rule has no explicit partial policy (FR-PAT-08): %', p_marking
        using errcode = 'invalid_parameter_value';
    end if;

    if v_partial ->> 'mode' = 'ALL_OR_NOTHING' then
      if v_selected_wrong = 0 and v_selected_correct = v_total_correct then
        return pg_catalog.jsonb_build_object(
          'marks', v_correct,
          'status', 'CORRECT',
          'explanation',
            'Correct. You selected all ' || v_total_correct::text
            || ' correct options and nothing else. Awarded ' || v_correct_txt || '.');
      end if;
      return pg_catalog.jsonb_build_object(
        'marks', v_incorrect,
        'status', 'INCORRECT',
        'explanation',
          'Incorrect. This question is scored all-or-nothing and requires exactly the '
          || v_total_correct::text || ' correct options. ' || v_incorrect_txt || ' applied.');
    end if;

    -- LADDER_BY_CORRECT_SELECTED.
    --
    -- THIS IS THE PART THAT IS WIDELY IMPLEMENTED WRONG (FR-PAT-06).
    -- The award for only-correct-but-not-all is a fixed LADDER read from
    -- data: the award equals the number of correct options selected.
    -- 3 of 4 -> +3, 2 of 4 -> +2, 1 of 4 -> +1. It is NOT the proportional
    -- formula 4 x correct/total, which has never been the published scheme
    -- and which systematically under-scores every candidate.
    -- Any incorrect option selected -> the flat penalty (-1 in 2026, moved
    -- from -2 in 2025), never a scaled one.

    v_penalty := (v_partial ->> 'penaltyIfAnyIncorrect')::numeric;
    v_penalty_txt := v_partial ->> 'penaltyIfAnyIncorrect';

    if v_selected_wrong > 0 then
      return pg_catalog.jsonb_build_object(
        'marks', v_penalty,
        'status', 'INCORRECT',
        'explanation',
          'Incorrect. You selected ' || v_selected_wrong::text
          || ' option(s) that are not in the answer key, so the partial-credit ladder does not apply and '
          || v_penalty_txt || ' is applied.');
    end if;

    if v_selected_correct = v_total_correct then
      v_award := (v_partial ->> 'awardIfAllCorrectSelected')::numeric;
      return pg_catalog.jsonb_build_object(
        'marks', v_award,
        'status', 'CORRECT',
        'explanation',
          'Correct. You selected all ' || v_total_correct::text
          || ' correct options. Awarded ' || (v_partial ->> 'awardIfAllCorrectSelected') || '.');
    end if;

    v_award_txt := coalesce(
      v_partial -> 'awardBySelectedCorrectCount' ->> v_selected_correct::text, '0');
    v_award := v_award_txt::numeric;

    return pg_catalog.jsonb_build_object(
      'marks', v_award,
      'status', 'PARTIALLY_CORRECT',
      'explanation',
        'Partially correct. You selected ' || v_selected_correct::text || ' of the '
        || v_total_correct::text || ' correct options and no incorrect ones. '
        || 'The marking ladder awards ' || v_award_txt || ' for this - not '
        || private.format_proportional(v_correct, v_selected_correct, v_total_correct)
        || ', which is a commonly published but incorrect formula.');

  elsif v_type in ('NUMERIC_INTEGER', 'NUMERIC_DECIMAL') then

    if not v_attempted then
      return pg_catalog.jsonb_build_object(
        'marks', v_unattempted, 'status', 'UNATTEMPTED', 'explanation', 'Not answered.');
    end if;

    if p_key_numeric is null then
      -- A numeric question whose key has no value is a content defect.
      -- Refusing to guess is correct: surface it rather than scoring the
      -- student zero.
      raise exception
        'answer key for a numeric question has no numeric value; refusing to score'
        using errcode = 'invalid_parameter_value';
    end if;

    v_spec := p_marking -> 'numeric';
    v_verdict := public.grade_numeric(p_numeric_raw, p_key_numeric, v_spec);

    if v_verdict = 'CORRECT' then
      return pg_catalog.jsonb_build_object(
        'marks', v_correct,
        'status', 'CORRECT',
        'explanation', 'Correct. Awarded ' || v_correct_txt || '.');
    end if;

    if v_verdict = 'UNPARSEABLE' then
      -- penaliseUnparseable is separate from `incorrect` so a body that does
      -- not penalise malformed numeric entry can be represented without
      -- abusing the incorrect value.
      if coalesce((p_marking ->> 'penaliseUnparseable')::boolean, false) then
        return pg_catalog.jsonb_build_object(
          'marks', v_incorrect,
          'status', 'UNPARSEABLE',
          'explanation',
            'Your response could not be read as a number. Scored as incorrect ('
            || v_incorrect_txt || ').');
      end if;
      return pg_catalog.jsonb_build_object(
        'marks', 0,
        'status', 'UNPARSEABLE',
        'explanation',
          'Your response could not be read as a number. No marks awarded and no penalty applied.');
    end if;

    return pg_catalog.jsonb_build_object(
      'marks', v_incorrect,
      'status', 'INCORRECT',
      'explanation',
        case v_spec ->> 'kind'
          when 'EXACT_INTEGER' then
            'Incorrect. The expected answer is the integer '
            || private.js_number_text(p_key_numeric) || '. ' || v_incorrect_txt || ' applied.'
          when 'TOLERANCE' then
            'Incorrect. The expected answer is ' || private.js_number_text(p_key_numeric)
            || ' within ' || (v_spec ->> 'toleranceAbs') || '. ' || v_incorrect_txt || ' applied.'
          when 'ROUNDED' then
            'Incorrect. The expected answer is ' || private.js_number_text(p_key_numeric)
            || ', compared after '
            || case when v_spec ->> 'mode' = 'TRUNCATE' then 'truncating' else 'rounding' end
            || ' to ' || (v_spec ->> 'decimals') || ' decimal place(s). '
            || v_incorrect_txt || ' applied.'
        end);
  end if;

  raise exception 'unknown question type % in marking rule', v_type
    using errcode = 'invalid_parameter_value';
end;
$$;

comment on function public.score_question(jsonb, uuid[], text, uuid[], numeric, text) is
  'FR-SCR-02 / FR-SCR-18. Pure grading of one response. Structurally blind to '
  'marked_for_review, visited, time_spent_ms and client_seq (FR-ATT-03) because '
  'they are not parameters. Implements the JEE Advanced partial-credit LADDER, '
  'never the proportional formula.';

-- ---------------------------------------------------------------------
-- Canonical serialisation and the scoring-config fingerprint (FR-PAT-07)
-- ---------------------------------------------------------------------
-- jsonb sorts object keys by (length, bytes), not lexicographically, so
-- jsonb::text is NOT a canonical form and cannot be used here. This
-- reproduces canonicalize() from packages/domain/src/scoring/fingerprint.ts.
--
-- The database hashes the canonical form with SHA-256 and that value is
-- authoritative; the reference engine's FNV-1a value exists only so tests
-- and the tutor-mode preview can agree without a database. The two hashes
-- are deliberately different values over the same canonical string.

create or replace function private.canonical_json(v jsonb)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  t text := pg_catalog.jsonb_typeof(v);
  body text;
begin
  if v is null or t = 'null' then
    return 'null';
  elsif t = 'boolean' then
    return case when v = 'true'::jsonb then 'true' else 'false' end;
  elsif t = 'number' then
    return private.js_number_text((v #>> '{}')::numeric);
  elsif t = 'string' then
    return pg_catalog.to_json(v #>> '{}')::text;
  elsif t = 'array' then
    select pg_catalog.string_agg(private.canonical_json(e), ',' order by ord)
      into body
    from pg_catalog.jsonb_array_elements(v) with ordinality as x(e, ord);
    return '[' || coalesce(body, '') || ']';
  else
    -- Keys sorted with the C collation: byte order, which for the ASCII keys
    -- used by every marking rule is the same order JavaScript's `a < b`
    -- produces on UTF-16 code units.
    select pg_catalog.string_agg(
             pg_catalog.to_json(k)::text || ':' || private.canonical_json(val),
             ',' order by k collate "C")
      into body
    from pg_catalog.jsonb_each(v) as x(k, val);
    return '{' || coalesce(body, '') || '}';
  end if;
end;
$$;

create or replace function private.fingerprint(v jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- pg_catalog.sha256 is core since PostgreSQL 11, so the scoring path takes
  -- no dependency on pgcrypto and therefore none on which schema an extension
  -- happened to be installed into.
  select pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(private.canonical_json(v), 'UTF8')),
           'hex')
$$;

comment on function private.fingerprint(jsonb) is
  'FR-PAT-07. SHA-256 over the canonical form. Authoritative value for '
  'attempt_result.scoring_config_hash.';

revoke all on function private.nonascii_decimal_digits() from public;
revoke all on function private.js_number_text(numeric) from public;
revoke all on function private.format_proportional(numeric, integer, integer) from public;
revoke all on function private.canonical_json(jsonb) from public;
revoke all on function private.fingerprint(jsonb) from public;
revoke all on function public.normalize_numeric(text) from public;
revoke all on function public.grade_numeric(text, numeric, jsonb) from public;
revoke all on function public.score_question(jsonb, uuid[], text, uuid[], numeric, text) from public;

