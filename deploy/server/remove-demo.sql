-- =============================================================================
--  Remove the demo clinic from a NEW production database — run ONCE, right after
--  setup-db and migrate, and before anybody real signs up
-- =============================================================================
--      docker exec -i kokli-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot physio_clinic' \
--        < deploy/server/remove-demo.sql
--
--  WHY THIS EXISTS
--  ---------------
--  scripts/setup-db.js always seeds a demo tenant: the clinic `aarogya` with
--  working logins admin@aarogyaphysio.in / admin123, doctor@... / doctor123 and
--  patient@example.com / patient123. The test suites and every laptop need it.
--  A public server must not have it: those passwords are in this repository, so
--  anyone could sign in as the admin of a live clinic on your domain — rewrite
--  its site, connect their own Razorpay keys, take real patients' money.
--
--  What stays: the three plans and the platform owner (whose password is
--  replaced next — DEPLOYMENT.md §7b).
--
--  ORDER
--  -----
--  Children before parents. The foreign keys are RESTRICT, so a wrong order makes
--  a statement fail rather than leave orphans — and it all runs in one
--  transaction, so a failure leaves the database exactly as it was.
--
--  It refuses to run on a database that has any clinic other than the demo one.
-- =============================================================================

SET @demo := (SELECT id FROM clinics WHERE slug = 'aarogya');

-- ---------------------------------------------------------------------------
--  The guard: refuse on any database that has a real clinic
-- ---------------------------------------------------------------------------
--  A row that breaks a CHECK constraint is an error, and the mysql client stops
--  the script at the first error — before the transaction below begins. The
--  table is TEMPORARY, so it vanishes with the session, refused or not.
--
--  (Not a stored procedure with SIGNAL: when that fires, the client stops before
--  the DROP PROCEDURE after it, and the procedure stays behind — owned by root,
--  unreadable by the app's user, so every `mysqldump --routines` after that
--  fails. Every backup, and so every deploy, with it.)
CREATE TEMPORARY TABLE kokli_guard (
  ok TINYINT NOT NULL,
  CONSTRAINT refusing_this_database_has_real_clinics CHECK (ok = 1)
);
INSERT INTO kokli_guard
  SELECT IF(COUNT(*) = 0, 1, 0) FROM clinics WHERE slug <> 'aarogya';

START TRANSACTION;

DELETE FROM payments           WHERE clinic_id = @demo;
DELETE FROM consultation_notes WHERE clinic_id = @demo;
DELETE FROM reviews            WHERE clinic_id = @demo;
DELETE FROM whatsapp_messages  WHERE clinic_id = @demo;
DELETE FROM appointments       WHERE clinic_id = @demo;
DELETE FROM patient_packages   WHERE clinic_id = @demo;
DELETE FROM packages           WHERE clinic_id = @demo;
DELETE FROM availability_rules WHERE clinic_id = @demo;
DELETE FROM time_off           WHERE clinic_id = @demo;
DELETE FROM services           WHERE clinic_id = @demo;
DELETE FROM login_otps         WHERE clinic_id = @demo;
DELETE FROM platform_invoices  WHERE clinic_id = @demo;
DELETE FROM subscriptions      WHERE clinic_id = @demo;
-- The clinic points at its owner and the owner at the clinic; break the circle.
UPDATE clinics SET owner_user_id = NULL WHERE id = @demo;
-- Also removes their patient_profiles and password_resets (ON DELETE CASCADE).
DELETE FROM users              WHERE clinic_id = @demo;
DELETE FROM clinics            WHERE id = @demo;
-- Throttle rows for the demo logins.
DELETE FROM login_attempts
 WHERE attempt_key LIKE '%@aarogyaphysio.in|%' OR attempt_key LIKE 'patient@example.com|%';

COMMIT;

-- What is left. Expect: 0 clinics, only owner@kokli.in, 3 plans.
SELECT (SELECT COUNT(*) FROM clinics)          AS clinics,
       (SELECT GROUP_CONCAT(email) FROM users) AS users,
       (SELECT COUNT(*) FROM plans)            AS plans;
