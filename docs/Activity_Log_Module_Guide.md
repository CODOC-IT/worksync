# Activity Log Module

## Architecture

The Activity Log is an immutable PostgreSQL-backed audit trail, not a frontend message list.

```
ActivityLogView -> activityApi -> /api/activity -> controller -> service -> repository -> audit.*
Core backend mutations -----------------------> activity.service.recordActivitySafe
```

Backend files live in `backend/src/activity/`; frontend files live in
`frontend/src/features/activity/`. `database/22_audit_enhancements.sql` extends the baseline
audit tables with durable display snapshots, module/result/source fields, metadata, indexes,
and immutability triggers.

## Security model

- Audit records and their changes reject `UPDATE` and `DELETE` at the database layer.
- There are no HTTP mutation endpoints for audit events.
- Actor, project, task, and entity names are snapshotted so archived/deleted records remain
  understandable.
- Fields whose names resemble passwords, secrets, tokens, cookies, credentials, API keys, or
  sessions are discarded by the service before persistence.
- The failed-request middleware records method/path/status only. It never reads request bodies
  or authorization headers.
- Admin sees all events. Team Leads see their own events and projects they lead. Team Members
  see their own events and accessible projects without private permission/authentication data.
  HR sees their own events and attendance events.
- CSV export is Admin-only and the export is itself audited.

## API

- `GET /api/activity` — paginated, filtered list.
- `GET /api/activity/:id` — scoped detail.
- `GET /api/activity/export` — filtered CSV, Admin-only.

Supported filters include UTC date bounds, actor, actor role, project, task, module, action,
entity type, status, priority, result, source, changed field, search, own activity, importance,
attachments, mentions, deleted records, sort, and pagination.

## Current publishers

- Project creation/update/archive and membership changes.
- Task creation/update/delete, assignment, priority, status, and review decisions.
- Project-chat creation, comments, mentions, edits, deletes, attachments, and resolution.
- Login success/failure/block and logout.
- All failed/blocked API responses through centralized middleware.
- Activity CSV exports.

Frontend-only modules should be instrumented when their mutations move behind authenticated
backend services. The client must not be allowed to submit arbitrary audit events because that
would permit forged audit history.

## Deployment

New databases receive the enhancement through `database/setup.sql`. For an existing WorkSync
database, execute `database/22_audit_enhancements.sql` once before deploying this API version.

