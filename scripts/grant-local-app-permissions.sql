-- Run as ecopulse_migrator after the initial migration.
\set ON_ERROR_STOP on

BEGIN;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ecopulse_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ecopulse_app;

GRANT SELECT, INSERT ON TABLE users, scans, point_movements, redemptions TO ecopulse_app;
GRANT INSERT ON TABLE verifications TO ecopulse_app;
GRANT SELECT, INSERT, UPDATE ON TABLE deliveries TO ecopulse_app;
GRANT SELECT ON TABLE rewards TO ecopulse_app;

COMMIT;
