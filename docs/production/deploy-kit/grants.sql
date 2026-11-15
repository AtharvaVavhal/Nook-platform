-- Explicit grants for the Nook production database. Run AFTER every `prisma migrate deploy`, as nook_migrator (the owner)
-- or as the operator. Idempotent. Derived from scripts/ci/integration.js grantRuntime(): the matrix CI proves the
-- application runs under. Review before use; nothing here is blanket or default-privilege based.
--   nook_app    : SELECT, INSERT, UPDATE on application tables, EXCEPT the append-only set (SELECT, INSERT only; 13 tables);
--                 SELECT on the view effective_stay_assignments; USAGE, SELECT on sequences; NO DELETE, NO DDL.
--   nook_backup : SELECT on every table (including _prisma_migrations), the view and sequences; nothing else.
DO $grants$
DECLARE
  t record;
  append_only text[] := ARRAY[
    'transfers', 'transfer_command_receipts', 'stay_assignment_replacements', 'transfer_finance_reviews',
    'transfer_finance_resolutions', 'audit_events', 'invoice_voids', 'correction_command_receipts',
    'correction_finance_links',
    -- Beyond CI's nine: the four financial tables below have an unconditional BEFORE UPDATE OR DELETE trigger that
    -- raises, and no application path updates or row-locks them (static search + the full integration suite passed
    -- twice with UPDATE removed). The privilege is removed as well, so immutability does not rest on a trigger alone.
    'payments', 'payment_reversals', 'invoice_adjustments', 'payment_idempotency_keys'
  ];
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1
  LOOP
    -- converge to exactly the matrix below, also on a database that already holds older grants
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM nook_app, nook_backup', t.tablename);
    IF t.tablename = ANY (append_only) THEN
      EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO nook_app', t.tablename);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO nook_app', t.tablename);
    END IF;
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO nook_backup', t.tablename);
  END LOOP;
  REVOKE ALL ON TABLE public.effective_stay_assignments, public._prisma_migrations FROM nook_app, nook_backup;
  GRANT SELECT ON TABLE public.effective_stay_assignments TO nook_app, nook_backup;
  -- The migration ledger is part of the database state a restore must reproduce: backups read it, the runtime never does.
  GRANT SELECT ON TABLE public._prisma_migrations TO nook_backup;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nook_app;
  GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO nook_backup;
END
$grants$;
