-- Run only against the local PostgreSQL 18 development cluster.
-- This creates a role and database; it does not create application tables.
-- ON_ERROR_STOP prevents later steps from running if a role or database already exists.
\set ON_ERROR_STOP on

SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), current_setting('server_version');

CREATE ROLE ecopulse_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password ecopulse_app

CREATE DATABASE ecopulse_dev OWNER ecopulse_app ENCODING 'UTF8' TEMPLATE template0;
REVOKE CONNECT ON DATABASE ecopulse_dev FROM PUBLIC;
