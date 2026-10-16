-- Run once against shared-postgres as a superuser:
--   docker exec -i shared-postgres psql -U postgres < deploy/init-db.sql
CREATE ROLE wealth_portfolio LOGIN PASSWORD 'change-me';
CREATE DATABASE wealth_portfolio OWNER wealth_portfolio;
-- Phase 7 (AI agents) will add a read-only role here; nothing else needs it yet.
