-- =============================================================================
--  Runs ONCE, the first time MySQL starts with an empty data volume.
-- =============================================================================
--  By now the official image has created the `physio_clinic` database and the
--  `kokli` user with ALL on it (MYSQL_DATABASE / MYSQL_USER in the compose file).
--
--  `node scripts/backup.js --verify` proves the newest backup can be restored by
--  restoring it into a throwaway database, `physio_clinic_verify`. The app's own
--  user has to be allowed to create and drop that one — and nothing else.
-- =============================================================================

-- The underscores are escaped because in a GRANT an unescaped `_` is a wildcard
-- for any single character. Escaped, this names one database and no other.
GRANT ALL PRIVILEGES ON `physio\_clinic\_verify`.* TO 'kokli'@'%';
