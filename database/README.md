# WorkSync PostgreSQL database

This directory contains the PostgreSQL 15+ baseline converted from
`OfficeManagementDB_3NF.sql`. The source was a SQL Server 2022 script despite
its `.sql` name, so SQL Server-only types and expressions were translated
rather than copied unchanged.

## Install

Create an empty database, then run the baseline from the repository root:

```sh
createdb worksync
psql -v ON_ERROR_STOP=1 -d worksync -f database/setup.sql
```

`setup.sql` runs all files in one transaction and stops on the first error.
It is intentionally a one-time baseline; use versioned migrations for later
changes.

## Layout

- `00_schemas.sql` and `01_support_functions.sql`: prerequisites.
- `02_*_tables.sql` through `12_*_tables.sql`: all 70 tables, grouped by the
  11 business schemas.
- `13_foreign_keys.sql`: all 163 relationships, separated to avoid circular
  creation-order problems.
- `14_integrity.sql`: temporary-role scope validation, self-review prevention,
  and optimistic-concurrency triggers.
- `15_indexes.sql`: all 28 source indexes.
- `16_views.sql`: the five reporting/read-model queries.
- `17_seed.sql`: stable reference data.

SQL Server `ROWVERSION` columns are implemented as `bigint` counters maintained
by `BEFORE UPDATE` triggers. UTC instants use `timestamptz(0)`. The nullable
holiday-scope unique key uses PostgreSQL 15's `NULLS NOT DISTINCT` so its
behavior matches SQL Server.

Rules requiring graph traversal, authorization against the current actor, or
multi-table workflow transitions still belong in transactional service code.
That includes acyclic task dependencies, project membership consistency,
overlap checks, atomic approval application/auditing, mandatory-notification
protection, and last-administrator protection.
