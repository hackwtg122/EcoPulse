-- Run as the local postgres administrator before the initial migration.
-- This separates schema ownership from the runtime application role.
\set ON_ERROR_STOP on

SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), current_setting('server_version');

SELECT (
  current_database() = 'postgres'
  AND current_user = 'postgres'
  AND host(inet_server_addr()) = '127.0.0.1'
  AND inet_server_port() = 5432
) AS safe_admin_context \gset
\if :safe_admin_context
\else
  \echo 'Refusing to continue: expected local postgres administrator on 127.0.0.1:5432/postgres.'
  \quit 3
\endif

BEGIN;
CREATE ROLE ecopulse_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password ecopulse_migrator

ALTER DATABASE ecopulse_dev OWNER TO ecopulse_migrator;
REVOKE CONNECT, TEMPORARY ON DATABASE ecopulse_dev FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE ecopulse_dev FROM ecopulse_app;
GRANT CONNECT ON DATABASE ecopulse_dev TO ecopulse_app;
COMMIT;

\connect ecopulse_dev postgres 127.0.0.1 5432

BEGIN;
ALTER SCHEMA public OWNER TO ecopulse_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, ecopulse_app;
GRANT USAGE ON SCHEMA public TO ecopulse_app;
COMMIT;
