<div align="center">

# ⚡ WORKSYNC CORE ⚡

### 📚 Specifications & Database Architecture Hub 📚

![WorkSync Banner](https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=0,2,10,25,30&height=220&section=header&text=WorkSync%20Docs&fontSize=50&animation=twinkling&fontColor=ffffff)

[![Vite](https://img.shields.io/badge/Vite-6.4.3-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18.3.1-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%2B-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

<p align="center">
  <a href="#-about-this-branch"><b>About Branch</b></a> •
  <a href="#-uploaded-documentation-files"><b>Documentation Files</b></a> •
  <a href="#-modules-built-by-abdulazeemhashmi"><b>Assigned Modules</b></a> •
  <a href="#-10-active-interns-roster"><b>Intern Roster</b></a> •
  <a href="#-database-architecture-overview"><b>DB Architecture</b></a> •
  <a href="#-getting-started"><b>Getting Started</b></a>
</p>

</div>

---

## 🌟 About This Branch

> 🚀 **Branch Name**: `docs/upload-docx-specifications`  
> 📌 **Repository**: [`Salman-ahmed-2/worksync`](https://github.com/Salman-ahmed-2/worksync)  
> 👤 **Contributor**: **Abdul Azeem Hashmi** ([`@AbdulAzeemHashmi`](https://github.com/AbdulAzeemHashmi))  

This branch contains the full architectural baseline for **WorkSync**, including the original **System Specifications DOCX files**, extracted plaintext formats for quick reading, and the complete application implementation for **Module 06 (Team Members Management)** and **Module 09 (Personal Profile & Settings)**.

---

## 📄 Uploaded Documentation Files

<div align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&pause=1000&color=00F2FE&center=true&vCenter=true&width=550&lines=Roles%2C+Permissions+%26+Workflows+Docx;70-Table+PostgreSQL+3NF+Schema+ERD;Plaintext+Extracted+Content+Files" alt="Typing SVG" />
</div>

### 📁 Folder & File Structure

```text
worksync/
├── 📄 Office_Management_System_Roles_Permissions_and_Workflows.docx
├── 📄 OfficeManagementDB_PostgreSQL_Schema_and_ERD_Report.docx
└── 📁 docs/
    ├── 📝 Office_Management_System_Roles_Permissions_and_Workflows_content.txt
    └── 📝 OfficeManagementDB_PostgreSQL_Schema_and_ERD_Report_content.txt
```

### 🔍 Document Details

| File Name | Format | Size | Description |
|---|:---:|:---:|---|
| `Office_Management_System_Roles_Permissions_and_Workflows.docx` | DOCX | 44.9 KB | Functional specification for access control, non self-approval safeguards, and approval routing. |
| `OfficeManagementDB_PostgreSQL_Schema_and_ERD_Report.docx` | DOCX | 69.8 KB | 70 table PostgreSQL 3NF normalized schema design and ERD report. |
| `docs/Office_Management_System_Roles_Permissions_and_Workflows_content.txt` | TXT | 17.7 KB | Plaintext extracted content for direct reading inside editor or GitHub. |
| `docs/OfficeManagementDB_PostgreSQL_Schema_and_ERD_Report_content.txt` | TXT | 42.1 KB | Plaintext extracted database dictionary, schema catalogs, and integrity rules. |

---

## 👑 Modules Built by AbdulAzeemHashmi

### 1. 👥 Team Members Management (Module 06)

* 📊 **Team Members Hub**: Grid card layout and compact table view mode.
* 📈 **Overview Metrics**: Active workload, total members, Team Lead and HR counts.
* 🔍 **Search & Filter**: Real time filter by Role, Status, and search across Name, Email, Title, and GitHub username.
* 📝 **Member CRUD Modals**: Form validation for member addition and property editing.
* 🚨 **Task Reassignment Safety Check**: Deleting or deactivating members with active tasks is strictly blocked until tasks are bulk reassigned.
* 💾 **LocalStorage Sync**: User state persists across browser reloads.

### 2. 👤 Personal Profile Management (Module 09)

* 🎨 **Role Aware Hero Card**: Header banner with status indicators, title, department, email, and GitHub profile link.
* ✏️ **Edit Profile Modal**: Inline profile editor with immediate state persistence.
* 👑 **Role Specific Views**:
  * 🔴 **Admin**: System Overview quick stats (Active Users, Open Tasks, Active Projects).
  * 🟣 **Team Lead**: Exclusive **My Team** tab with open task counts for project members.
  * 🩷 **HR**: Exclusive **My HR Requests** tab for tracking submissions.
  * 🔵 **Team Member**: My Tasks, My Projects, Attendance Log, and Saved Prompts tabs.

### 3. ⚙️ Settings Management (Module 09)

* 🌙 **Appearance**: Dark Mode and Light Mode toggle switch (`toggleTheme()`).
* 🔔 **Notifications**: Email, In-App popups, and Weekly AI Digest toggles.
* 🔒 **Security**: Password update interface with instant inline validation feedback.
* ⏰ **Office Hours**: Configurable workday start/end times and break limit slider.
* 🛡️ **Admin Safeguards**: Masked AI API key display, JSON Vault Backup exporter, and Sole Admin Deactivation protection check.

---

## 👥 10 Active Interns Roster

| # | Intern Name | GitHub Username | Assigned Module |
|---|---|---|---|
| 1 | Salman Ahmed | [`@Salman-ahmed-2`](https://github.com/Salman-ahmed-2) | Dashboard, Login & Frontend |
| 2 | Maryam | [`@meowryam`](https://github.com/meowryam) | Reports |
| 3 | Laiba Inqilab | [`@laibainqilab-ds`](https://github.com/laibainqilab-ds) | Project Management & Calendar |
| 4 | Abiha Ibbran | [`@abihajibbran1-lang`](https://github.com/abihajibbran1-lang) | Task Creation & Comments |
| 5 | Bilal Mughal | [`@Bilalmughal-07`](https://github.com/Bilalmughal-07) | Kanban Board & Notifications |
| 6 | **Abdul Azeem Hashmi** | [`@AbdulAzeemHashmi`](https://github.com/AbdulAzeemHashmi) | **Team Members, Personal Profile & Settings** |
| 7 | Taha Sohail | [`@TahaSohail-Goat`](https://github.com/TahaSohail-Goat) | Dashboard & Frontend Setup |
| 8 | Hassaan Ahmed | [`@hassaanahmed-dev`](https://github.com/hassaanahmed-dev) | Prompt Builder |
| 9 | Inshrah Mumtaz | [`@inshrahmumtaz`](https://github.com/inshrahmumtaz) | Attendance & Breaks |
| 10 | Muhammad Haris | [`@muhammad-haris2`](https://github.com/muhammad-haris2) | Activity Log |

---

## 🗄️ Database Architecture Overview

The database specification defines **70 tables** split across **11 business schemas**:

```text
                            +-----------------------------+
                            |  POSTGRESQL 16+ DATABASE    |
                            +-----------------------------+
                                           |
    +-----------+-----------+-----------+--+--+-----------+-----------+-----------+
    |           |           |           |     |           |           |           |
    v           v           v           v     v           v           v           v
 ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐ ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐
 │ org │     │ iam │     │work │     │collab││ hr  │     │cal  │     │ rpt │     │audit│
 └─────┘     └─────┘     └─────┘     └─────┘ └─────┘     └─────┘     └─────┘     └─────┘
  (3)         (10)        (18)         (8)    (13)        (3)         (4)         (2)
```

<details>
<summary><b>🔍 Click to Expand Schema Breakdown (11 Schemas / 70 Tables)</b></summary>

<br />

1. **`org` (3 tables)**: Organizations, Departments, Teams.
2. **`iam` (10 tables)**: Users, UserProfiles, UserCredentials, Roles, Permissions, RolePermissions, UserRoles, PermissionAssignmentHistory, TeamLeadProjectScopes, HrDepartmentScopes.
3. **`work` (18 tables)**: Projects, ProjectStatuses, TaskStatuses, Priorities, ProjectMembers, ProjectReviewerDesignations, ProjectMilestones, ProjectPolicies, Tasks, TaskAssignees, TaskAcceptanceCriteria, TaskDependencies, TaskStatusHistory, TaskBlockers, ChangeRequestTypes, TaskChangeRequests, TaskChangeRequestItems, ChangeRequestReviews.
4. **`collab` (8 tables)**: StoredFiles, DiscussionThreads, Comments, CommentMentions, ProjectFiles, TaskFiles, CommentFiles, LeaveRequestFiles.
5. **`hr` (13 tables)**: WorkSchedules, WorkScheduleDays, UserWorkScheduleAssignments, Holidays, AttendanceStatuses, AttendanceRecords, AttendancePunches, AttendanceCorrectionRequests, AttendanceCorrectionItems, AttendanceCorrectionReviews, LeaveTypes, LeaveRequests, LeaveRequestReviews.
6. **`calendar` (3 tables)**: EventTypes, Events, EventAttendees.
7. **`reporting` (4 tables)**: ReportDefinitions, SavedReports, ReportRuns, ReportExports.
8. **`ai` (2 tables)**: PromptOutputTypes, PromptGenerations.
9. **`notify` (4 tables)**: NotificationTypes, UserNotificationPreferences, Notifications, UserNotifications.
10. **`config` (3 tables)**: SettingDefinitions, OrganizationSettingValues, UserSettingValues.
11. **`audit` (2 tables)**: AuditEvents, AuditEventChanges.

</details>

---

## ⚡ Getting Started

### Prerequisites

* Node.js v18.0.0 or higher
* npm v9.0.0 or higher

### Local Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Salman-ahmed-2/worksync.git
   cd worksync
   ```

2. **Switch to this documentation branch**:
   ```bash
   git checkout docs/upload-docx-specifications
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Start development server**:
   ```bash
   npm run dev
   ```

5. **Build verification**:
   ```bash
   npm run build
   ```

---

<div align="center">

Uploaded and Maintained by **Abdul Azeem Hashmi** for **WorkSync Project**

[![GitHub](https://img.shields.io/badge/GitHub-AbdulAzeemHashmi-181717?style=flat-square&logo=github)](https://github.com/AbdulAzeemHashmi)

</div>
