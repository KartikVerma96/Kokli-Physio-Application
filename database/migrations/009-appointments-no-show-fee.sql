-- ===========================================================================
--  MIGRATION 009 — THE COLUMN MIGRATION 003 NEVER MANAGED TO ADD
-- ===========================================================================
--
--      npm run db:migrate
--
--  WHAT WENT WRONG
--  ---------------
--  Migration 003 added `appointments.no_show_fee_paise` and
--  `appointments.package_session_forfeited` in ONE `ALTER TABLE`. MySQL applies
--  a multi-clause ALTER all or nothing — and schema.sql already creates
--  `package_session_forfeited`, so on any database built from schema.sql the
--  whole statement failed with "duplicate column", migrate.js read that as
--  "already done", and `no_show_fee_paise` was never created.
--
--  Every appointment status change writes that column. On such a database,
--  Confirm, Start, Complete and No-show all failed with "Could not update the
--  appointment" — invisible on a long-lived development database (built before
--  the second column existed), certain on every fresh one.
--
--  schema.sql now creates the column itself. This is for databases already
--  built from the earlier schema.sql: one clause, so that where the column does
--  exist, the "duplicate column" answer means exactly that, and nothing else in
--  the statement is lost with it.
-- ===========================================================================

ALTER TABLE appointments
  ADD COLUMN no_show_fee_paise INT UNSIGNED NOT NULL DEFAULT 0 AFTER amount_paise;
