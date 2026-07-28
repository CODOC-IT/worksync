# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added
- Project Module and Task Module now backed by PostgreSQL (real CRUD, role-based authorization, status history) instead of local/mock state.
- Project Chat now backed by PostgreSQL (real discussions, replies, mentions, and file attachments with real content-addressed storage) instead of a local JSON file and a hardcoded project list.
- Kanban board fully wired to the backend, with independent per-column scrolling and a searchable project selector.
- Notification list scrolls independently of the page, and clicking a notification navigates to its related page.
- Email notifications for Critical/High-priority events (task review requests, approvals, HR/attendance requests, etc.), with a professional sender identity and a 2-minute delivery digest.
- Implemented role-based attendance permissions.
- Team Members and Team Leads can view and edit only their own attendance.
- HR can view Team Member and Team Lead attendance in read-only mode.
- HR cannot view Admin attendance or edit other users' attendance.
- Admin can view and edit attendance for all users.
- Added authorization checks for attendance actions.
- Preserved attendance history, check-in/check-out, break management, break duration, and net working time functionality.

### Fixed
- Team Leads who create their own project are no longer locked out of managing it (tasks, edits, review notifications) due to a missing membership-role fallback.
- Email notifications were silently disabled for every user by default; now opt-out instead of opt-in.
- Local Postgres connections no longer fail due to an SSL requirement meant only for the deployed database.
- Notification emails were landing in spam due to a From/Reply-To domain mismatch; confirmed fixed via live inbox testing.
- Registration/OTP verification could crash with a database constraint error, and Team Lead/HR roles could silently fail to persist after signup.