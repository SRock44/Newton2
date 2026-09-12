-- Runs only on a brand-new Postgres data volume (docker-entrypoint-initdb.d scripts are
-- skipped once /var/lib/postgresql/data already has a cluster). Keycloak needs its own
-- database, separate from the app's `newton` database, to store its own realm/user state
-- persistently instead of the ephemeral in-memory DB `start-dev` uses by default -- see
-- the KC_DB_* comment on the keycloak service in docker-compose.yml.
CREATE DATABASE keycloak OWNER newton;
