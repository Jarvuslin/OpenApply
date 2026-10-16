-- Run after both preserved employer-account history and the Telegram archive/channel bridge.
-- Retain the old employer_account_attempts table as a permanent no-replay ledger.
BEGIN;
LOCK TABLE work_items, employer_account_attempts IN SHARE ROW EXCLUSIVE MODE;

-- Match JSON.stringify's schema field order; jsonb::text has different spacing and key order.
CREATE FUNCTION pg_temp.account_setup_v2_snapshot(source jsonb, item_id text, revision integer, operation text, credential jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  credential_text text;
  credential_hash text;
  scope_text text;
BEGIN
  credential_text := '{"id":' || to_json(credential->>'id')::text
    || ',"scope":' || to_json(credential->>'scope')::text
    || ',"email":' || COALESCE(to_json(credential->>'email')::text, 'null')
    || ',"password":' || COALESCE(to_json(credential->>'password')::text, 'null') || '}';
  credential_hash := encode(sha256(convert_to(credential_text, 'UTF8')), 'hex');
  scope_text := '{"version":2,"revision":' || revision::text
    || ',"operation":' || to_json(operation)::text
    || ',"credentialRevision":' || to_json(credential_hash)::text
    || ',"purpose":"account_setup","workItemId":' || to_json(item_id)::text
    || ',"provider":"claude","signupUrl":' || to_json(source->>'signupUrl')::text
    || ',"tenantOrigin":' || to_json(source->>'tenantOrigin')::text
    || ',"credentialId":' || to_json(credential->>'id')::text
    || ',"email":' || to_json(source->>'email')::text
    || ',"accountStatus":' || to_json(source->>'accountStatus')::text
    || ',"maxSignupAttempts":1,"submissionAllowed":false}';
  RETURN scope_text::jsonb || jsonb_build_object('snapshotHash', encode(sha256(convert_to(scope_text, 'UTF8')), 'hex'));
END $$;

DO $$
DECLARE
  item work_items%ROWTYPE;
  credential credentials%ROWTYPE;
  account_scope jsonb;
  attempt jsonb;
  context jsonb;
  fresh boolean;
  question_id text;
  known_existing boolean;
BEGIN
  FOR item IN SELECT * FROM work_items WHERE intent = 'account_setup' ORDER BY created_at, id LOOP
    IF item.payload->'snapshot'->>'version' = '2' THEN CONTINUE; END IF;
    account_scope := item.payload->'snapshot';
    attempt := item.payload->'attempt';
    IF jsonb_typeof(account_scope) IS DISTINCT FROM 'object' OR jsonb_typeof(attempt) IS DISTINCT FROM 'object'
      OR NOT account_scope ?& ARRAY['version', 'workItemId', 'purpose', 'maxSignupAttempts', 'submissionAllowed', 'accountStatus', 'email', 'tenantOrigin', 'signupUrl', 'credentialId']
      OR NOT attempt ?& ARRAY['signupAttempts', 'begunAt', 'outcome', 'observedAt']
      OR account_scope->>'version' IS DISTINCT FROM '1'
      OR item.kind <> 'pilot_task' OR item.provider <> 'claude'
      OR item.job_id IS NOT NULL OR item.campaign_id IS NOT NULL OR item.chat_run_id IS NOT NULL OR item.application_id IS NOT NULL
      OR account_scope->>'workItemId' IS DISTINCT FROM item.id
      OR account_scope->>'purpose' IS DISTINCT FROM 'account_setup'
      OR account_scope->>'maxSignupAttempts' IS DISTINCT FROM '1'
      OR account_scope->>'submissionAllowed' IS DISTINCT FROM 'false'
      OR (account_scope->>'accountStatus' IN ('unknown', 'absent_confirmed')) IS DISTINCT FROM true
      OR (attempt->>'signupAttempts' IN ('0', '1')) IS DISTINCT FROM true
      OR (attempt->>'signupAttempts' = '0') IS DISTINCT FROM (attempt->>'begunAt' IS NULL)
      OR lower(btrim(account_scope->>'email')) IS DISTINCT FROM account_scope->>'email'
      OR account_scope->>'tenantOrigin' !~ '^https://[a-z0-9.-]+$'
      OR account_scope->>'signupUrl' NOT LIKE (account_scope->>'tenantOrigin') || '/%'
    THEN RAISE EXCEPTION 'Unsupported account setup history; manual review is required before migration'; END IF;
    SELECT c.* INTO credential FROM credentials c
      WHERE c.id = account_scope->>'credentialId' AND c.user_id = item.user_id
        AND c.scope = substring((item.payload->'snapshot'->>'tenantOrigin') FROM 9)
        AND lower(btrim(c.email)) = item.payload->'snapshot'->>'email' AND c.password IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account setup credential requires manual recovery before migration'; END IF;
    fresh := item.attempts = 0 AND item.state = 'queued'
      AND attempt->>'signupAttempts' = '0' AND attempt->>'begunAt' IS NULL AND attempt->>'outcome' IS NULL
      AND NOT EXISTS (SELECT 1 FROM work_executions WHERE work_item_id = item.id);
    IF NOT fresh AND item.attempts < 1 THEN
      RAISE EXCEPTION 'Inconsistent account execution history; signup markers cannot be reset';
    END IF;
    known_existing := attempt->>'outcome' = 'already_exists';
    question_id := NULL;
    IF NOT fresh THEN
      question_id := gen_random_uuid()::text;
      INSERT INTO pilot_questions(id, user_id, kind, subject_type, subject_id, prompt, options, deep_link, expires_at)
      VALUES(question_id, item.user_id, 'choice', 'account_setup', item.id,
        'This preserved account attempt needs live verification. Review it securely in OpenApply or skip. Never send passwords in chat or Telegram.',
        '["Open secure account review","Skip"]'::jsonb, '/account-setup/' || item.id, CURRENT_TIMESTAMP + interval '24 hours');
    END IF;
    context := jsonb_build_object(
      'snapshot', pg_temp.account_setup_v2_snapshot(account_scope, item.id, GREATEST(item.attempts, 1), CASE WHEN fresh THEN 'signup' ELSE 'inspect' END, to_jsonb(credential)),
      'attempt', jsonb_build_object(
        'signupAttempts', (attempt->>'signupAttempts')::integer,
        'begunAt', attempt->'begunAt',
        'outcome', CASE WHEN fresh THEN NULL ELSE 'ambiguous' END,
        'observedAt', CASE WHEN fresh THEN NULL ELSE to_jsonb(CURRENT_TIMESTAMP) END,
        'phase', CASE WHEN fresh THEN 'checking' ELSE 'unknown' END,
        'reason', CASE WHEN fresh THEN NULL WHEN known_existing THEN 'existing_account_credentials' ELSE 'verification' END,
        'questionId', question_id, 'browserSessionId', NULL, 'currentUrl', NULL,
        'existingAccount', COALESCE(known_existing, false), 'noAccountObserved', false,
        'credentialPurpose', 'signup', 'authenticatedAt', NULL, 'mailbox', NULL, 'mailboxBlocked', false, 'verification', NULL));
    UPDATE work_items SET payload = context, state = CASE WHEN fresh THEN 'queued'::work_state ELSE 'needs_user'::work_state END,
      reason = CASE WHEN fresh THEN NULL ELSE 'Preserved account outcome requires live verification; signup cannot be replayed.' END,
      lease_token = NULL, lease_expires_at = NULL, worker_slot = NULL, current_execution_id = NULL,
      cancellation_requested_at = NULL, pause_requested_at = NULL,
      finished_at = CASE WHEN fresh THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at = CURRENT_TIMESTAMP
      WHERE id = item.id;
    UPDATE work_executions SET finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
      released_at = CASE WHEN consumed_at IS NULL THEN COALESCE(released_at, CURRENT_TIMESTAMP) ELSE released_at END
      WHERE work_item_id = item.id;
  END LOOP;
END $$;

DO $$
DECLARE
  legacy employer_account_attempts%ROWTYPE;
  item work_items%ROWTYPE;
  source_credential credentials%ROWTYPE;
  credential credentials%ROWTYPE;
  hostname text;
  account_email text;
  origin text;
  identity_text text;
  account_identity text;
  item_id text;
  question_id text;
  account_scope jsonb;
  attempt jsonb;
  context jsonb;
  signup_count integer;
  begun jsonb;
  known_existing boolean;
BEGIN
  FOR legacy IN SELECT * FROM employer_account_attempts ORDER BY created_at, id LOOP
    hostname := lower(split_part(btrim(legacy.scope), '/', 1));
    account_email := lower(btrim(legacy.email));
    origin := 'https://' || hostname;
    -- Unsupported legacy rows remain protected by the permanent enqueue guard, never discarded.
    IF hostname !~ '^[a-z0-9.-]+\.[a-z]+$' OR legacy.target_url NOT LIKE origin || '/%'
      OR legacy.target_url ~ '#' OR legacy.target_url ~* '[?&][^=&]*(password|token|secret|otp|code)'
    THEN CONTINUE; END IF;
    SELECT c.* INTO credential FROM credentials c WHERE c.user_id = legacy.user_id AND c.scope = hostname;
    IF FOUND AND (lower(btrim(credential.email)) IS DISTINCT FROM account_email OR credential.password IS NULL) THEN CONTINUE; END IF;
    IF NOT FOUND THEN
      SELECT * INTO source_credential FROM credentials WHERE id = legacy.credential_id AND user_id = legacy.user_id
        AND lower(btrim(email)) = account_email AND password IS NOT NULL;
      IF NOT FOUND THEN CONTINUE; END IF;
      INSERT INTO credentials(id, user_id, scope, email, password)
        VALUES(gen_random_uuid()::text, legacy.user_id, hostname, account_email, source_credential.password) RETURNING * INTO credential;
    END IF;
    identity_text := '{"tenantOrigin":' || to_json(origin)::text || ',"email":' || to_json(account_email)::text || '}';
    account_identity := 'account-setup:' || encode(sha256(convert_to(identity_text, 'UTF8')), 'hex');
    SELECT * INTO item FROM work_items WHERE user_id = legacy.user_id AND identity = account_identity;
    IF FOUND THEN
      item_id := item.id;
      attempt := item.payload->'attempt';
      question_id := attempt->>'questionId';
      account_scope := item.payload->'snapshot';
      IF account_scope->>'version' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Conflicting legacy account identity requires manual migration review'; END IF;
    ELSE
      item_id := legacy.id;
      attempt := '{}'::jsonb;
      question_id := NULL;
      account_scope := jsonb_build_object('signupUrl', legacy.target_url, 'tenantOrigin', origin, 'email', account_email, 'accountStatus', 'unknown');
      INSERT INTO work_items(id, user_id, kind, state, source, provider, identity, intent, title, company, attempts, updated_at)
        VALUES(item_id, legacy.user_id, 'pilot_task', 'needs_user', 'migration', 'claude', account_identity, 'account_setup', 'Review preserved employer account', hostname, 1, CURRENT_TIMESTAMP)
        RETURNING * INTO item;
    END IF;
    signup_count := CASE WHEN legacy.signup_started_at IS NOT NULL OR attempt->>'signupAttempts' = '1' THEN 1 ELSE 0 END;
    begun := attempt->'begunAt';
    IF begun IS NULL OR begun = 'null'::jsonb THEN begun := to_jsonb(legacy.signup_started_at AT TIME ZONE 'UTC'); END IF;
    known_existing := legacy.existing_account OR legacy.authenticated_at IS NOT NULL OR COALESCE((attempt->>'existingAccount')::boolean, false);
    IF question_id IS NULL THEN
      question_id := gen_random_uuid()::text;
      INSERT INTO pilot_questions(id, user_id, kind, subject_type, subject_id, prompt, options, deep_link, expires_at)
      VALUES(question_id, legacy.user_id, 'choice', 'account_setup', item_id,
        'This preserved employer account attempt needs review. Verify the current employer session securely in OpenApply or skip. Never send passwords in chat or Telegram.',
        '["Open secure account review","Skip"]'::jsonb, '/account-setup/' || item_id, CURRENT_TIMESTAMP + interval '24 hours');
    END IF;
    context := jsonb_build_object(
      'snapshot', pg_temp.account_setup_v2_snapshot(account_scope, item_id, GREATEST(item.attempts, 1), 'inspect', to_jsonb(credential)),
      'attempt', jsonb_build_object(
        'signupAttempts', signup_count, 'begunAt', begun, 'outcome', 'ambiguous', 'observedAt', CURRENT_TIMESTAMP,
        'phase', 'unknown', 'reason', CASE WHEN known_existing THEN 'existing_account_credentials' ELSE 'verification' END,
        'questionId', question_id, 'browserSessionId', NULL, 'currentUrl', origin,
        'existingAccount', known_existing, 'noAccountObserved', false, 'credentialPurpose', 'signup',
        'authenticatedAt', NULL, 'mailbox', NULL, 'mailboxBlocked', false, 'verification', NULL));
    UPDATE work_items SET payload = context, attempts = GREATEST(attempts, 1), state = 'needs_user',
      reason = 'Preserved employer account attempt requires live verification; signup cannot be replayed.',
      lease_token = NULL, lease_expires_at = NULL, worker_slot = NULL, current_execution_id = NULL,
      cancellation_requested_at = NULL, pause_requested_at = NULL, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = item_id;
    UPDATE work_executions SET finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
      released_at = CASE WHEN consumed_at IS NULL THEN COALESCE(released_at, CURRENT_TIMESTAMP) ELSE released_at END WHERE work_item_id = item_id;
    UPDATE pilot_questions SET status = 'cancelled' WHERE id = legacy.question_id AND user_id = legacy.user_id AND status = 'open' AND id <> question_id;
  END LOOP;
END $$;

DROP FUNCTION pg_temp.account_setup_v2_snapshot(jsonb, text, integer, text, jsonb);
COMMIT;
