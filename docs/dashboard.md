# Dashboard Module

## Architecture

The Dashboard is the central overview module that aggregates project, task, activity, and productivity metrics from backend services. It provides real-time insights while keeping business logic on the server.

```
DashboardView
      │
      ▼
dashboardApi
      │
      ▼
GET /api/dashboard
      │
      ▼
Dashboard Controller
      │
      ▼
Dashboard Service
      │
      ▼
Dashboard Repository
      │
      ▼
PostgreSQL Database
```

Backend files live in `backend/src/dashboard/`; frontend files live in
`frontend/src/features/dashboard/`. The dashboard aggregates data from projects, tasks, users, attendance, and activity log modules to generate statistics, charts, and recent activity.

---

## Features

- Overview cards displaying total projects, tasks, completed tasks, overdue tasks, and active users.
- Recent activity feed sourced from the immutable audit log.
- Task status and priority distribution.
- Project progress summaries.
- Upcoming deadlines and overdue task indicators.
- Calendar view with task filtering.
- Role-based dashboard content.
- Real-time dashboard updates after data mutations.

---

## Security Model

- Dashboard data is generated entirely on the backend.
- Users only receive data they are authorized to access.
- Admins can view organization-wide statistics.
- Team Leads can view metrics for projects they manage.
- Team Members can only view statistics related to their assigned or accessible projects.
- Sensitive information such as authentication data, credentials, and audit metadata is never exposed.
- Dashboard endpoints are protected using authenticated API requests.

---

## API

- `GET /api/dashboard` — Dashboard overview and statistics.
- `GET /api/dashboard/tasks` — Task summaries and counts.
- `GET /api/dashboard/projects` — Project statistics.
- `GET /api/dashboard/activity` — Recent activity feed.
- `GET /api/dashboard/calendar` — Calendar events and upcoming tasks.

---

## Current Dashboard Widgets

- Total Projects
- Total Tasks
- Completed Tasks
- Pending Tasks
- Overdue Tasks
- Active Users
- Recent Activity
- Project Progress
- Task Status Distribution
- Priority Distribution
- Calendar
- Upcoming Deadlines

---

## Filters

Supported dashboard filters include:

- Date Range
- Project
- Task Status
- Priority
- Assigned User
- Project Member
- Activity Type
- Calendar Date
- Search

Dashboard metrics automatically refresh whenever filters change.

---

## Recent Improvements

- Fixed dashboard task count inconsistencies.
- Corrected calendar filtering behavior.
- Fixed activity log filtering on the dashboard.
- Improved aggregation queries for better performance.
- Optimized dashboard API response times.
- Improved synchronization between dashboard statistics and backend data.

---

## Deployment

New WorkSync installations include the dashboard module automatically through the database setup scripts.

For existing deployments:

1. Apply the latest database migrations.
2. Deploy the updated backend dashboard services.
3. Deploy the updated frontend dashboard module.
4. Verify dashboard metrics, calendar filters, task counts, and activity log filters after deployment.