<div align="center">

# ⚡ WORKSYNC ⚡

### 🚀 Next-Gen Enterprise Office & Task Management System 🚀

![WorkSync Banner](https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=0,2,10,25,30&height=220&section=header&text=WorkSync%20Core&fontSize=50&animation=twinkling&fontColor=ffffff)

[![Vite](https://img.shields.io/badge/Vite-6.4.3-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18.3.1-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5.3-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4.1-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

<p align="center">
  <a href="#-about-the-project"><b>About</b></a> •
  <a href="#-modules-built-by-abdulazeemhashmi"><b>Assigned Modules</b></a> •
  <a href="#-10-active-interns-roster"><b>Intern Roster</b></a> •
  <a href="#-role-access-matrix"><b>Role Access</b></a> •
  <a href="#-getting-started"><b>Getting Started</b></a> •
  <a href="#-verification--build"><b>Verification</b></a>
</p>

</div>

---

## 🌟 About The Project

**WorkSync** is a high performance Cyberpunk Glassmorphism Office Management Workspace designed for modern engineering teams. It features real-time task orchestration, team management, granular role permissions, attendance tracking, and AI-powered workflow automation.

> 🛠️ **Branch Focus**: This branch (`feature/team-members`) houses the core implementation of **Module 06 (Team Members Management)** and **Module 09 (Personal Profile & Settings)** developed by **Abdul Azeem Hashmi**.

---

## 👑 Modules Built by AbdulAzeemHashmi

<div align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&pause=1000&color=00F2FE&center=true&vCenter=true&width=500&lines=Module+06%3A+Team+Members+Management;Module+09%3A+Personal+Profile+%26+Settings;Role-Based+Access+Control;Task+Reassignment+Safety+Checks" alt="Typing SVG" />
</div>

### 1. 👥 Team Members Management (Module 06)

* 📊 **Team Members Hub Dashboard**: Dual view modes (Grid cards + Compact Table view).
* 📈 **Overview Metrics**: Total Members, Active Members, Team Leads & HR count, and Active Task Workloads.
* 🔍 **Smart Search & Filters**: Search by Name, Email, GitHub handle, Department, or Title. Filter by Role and Status.
* 📝 **Member CRUD Operations**: Modals to add new members and update existing attributes with instant validation.
* 🚨 **Tricky Test: Task Reassignment Safety Check**: Deleting or deactivating members with active tasks is strictly blocked until all tasks are bulk reassigned to another active member.
* 💾 **LocalStorage Sync**: Persistent user state across sessions and browser refreshes.

### 2. 👤 Personal Profile Management (Module 09)

* 🎨 **Role Aware Hero Banner**: Dynamic status badges, position title, department, email, and direct GitHub links.
* ✏️ **Edit Profile Modal**: Modify name, email, title, department, GitHub username, and status in real-time.
* 👑 **Role Exclusive Views**:
  * 🔴 **Admin**: System Overview quick stats (Active Users, Open Tasks, Active Projects) + Admin star badge.
  * 🟣 **Team Lead**: Exclusive **My Team** tab listing assigned project members and task counts.
  * 🩷 **HR**: Exclusive **My HR Requests** tab tracking submitted and reviewed HR requests.
  * 🔵 **Team Member**: Core tabs for Tasks, Projects, Attendance, and Saved Prompts.

### 3. ⚙️ Settings Management (Module 09)

* 🌙 **Appearance & Theme**: Instant toggle between Cyberpunk Dark Mode and Light Mode.
* 🔔 **Notification Preferences**: Customizable controls for Email, In-App alerts, and Weekly AI Digest.
* 🔒 **Account Security**: Password change interface with instant inline validation feedback.
* ⏰ **Office Hours & Break Limits**: Custom workday hours and break limit sliders (Editable by Admin/HR, Read-Only for Team Lead, Hidden for Team Member).
* 🛡️ **Admin Safeguards**: Masked AI API key display, JSON Vault Backup exporter, and Sole Admin Deactivation protection check.

---

## 👥 10 Active Interns Roster

Below is the official mapping of all 10 active interns working on WorkSync:

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

## 🔐 Role Access Matrix

```
                      +-----------------------------------+
                      |      WORKSYNC ROLE SYSTEM         |
                      +-----------------------------------+
                                        |
     +-----------------+----------------+-----------------+-----------------+
     |                 |                                  |                 |
     v                 v                                  v                 v
┌───────────┐    ┌───────────┐                      ┌───────────┐     ┌───────────┐
│   ADMIN   │    │ TEAM LEAD │                      │    HR     │     │  MEMBER   │
└─────┬─────┘    └─────┬─────┘                      └─────┬─────┘     └─────┬─────┘
      │                │                                  │                 │
      ├─ Full Access   ├─ Manage Projects                 ├─ Attendance     └─ View Tasks
      ├─ System Stats  ├─ View My Team                    ├─ Edit Hours        View Projects
      ├─ Edit Hours    └─ View Office Hours               └─ View HR Requests  Basic Settings
      ├─ Export Vault
      └─ Admin Guard
```

<details>
<summary><b>🔍 Click to Expand Detailed Permission Breakdown</b></summary>

<br />

| Feature / Control | 🔴 Admin | 🟣 Team Lead | 🩷 HR | 🔵 Team Member |
|---|:---:|:---:|:---:|:---:|
| Edit Own Profile | ✅ | ✅ | ✅ | ✅ |
| Change User Roles | ✅ | ❌ | ❌ | ❌ |
| View System Quick Stats | ✅ | ❌ | ❌ | ❌ |
| View My Team Tab | ❌ | ✅ | ❌ | ❌ |
| View My HR Requests Tab | ❌ | ❌ | ✅ | ❌ |
| Edit Working Hours | ✅ | ❌ | ✅ | ❌ |
| View Working Hours | ✅ | ✅ | ✅ | ❌ |
| Masked AI API Key | ✅ | ❌ | ❌ | ❌ |
| Export System JSON Backup | ✅ | ❌ | ❌ | ❌ |
| Sole Admin Protection Test | ✅ | ❌ | ❌ | ❌ |

</details>

---

## 💻 Tech Stack

* **Framework**: [React 18](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/)
* **Build Tool**: [Vite 6](https://vitejs.dev/)
* **Styling**: Vanilla CSS + [Tailwind CSS](https://tailwindcss.com/) + Custom Glassmorphism System
* **Icons**: [Lucide React](https://lucide.dev/)
* **State Management**: React Context API (`AppContext.tsx`) + LocalStorage Persistence

---

## ⚡ Getting Started

### Prerequisites

* Node.js v18.0.0 or higher
* npm v9.0.0 or higher

### Installation & Run

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Salman-ahmed-2/worksync.git
   cd worksync
   ```

2. **Switch to feature branch**:
   ```bash
   git checkout feature/team-members
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

4. **Start the local development server**:
   ```bash
   npm run dev
   ```

5. **Open in browser**:
   Navigate to `http://localhost:5173`

---

## ✅ Verification & Build

To ensure production stability, run the production build check:

```bash
npm run build
```

Expected output:
```text
vite v6.4.3 building for production...
transforming...
✓ 2088 modules transformed.
rendering chunks...
dist/index.html                   0.87 kB
dist/assets/index-CClrezl4.css   73.54 kB
dist/assets/index-CsPwHgC_.js   471.38 kB
✓ built in 7.21s
```

---

<div align="center">

Made with ❤️ by **Abdul Azeem Hashmi** for **WorkSync Project**

[![GitHub](https://img.shields.io/badge/GitHub-AbdulAzeemHashmi-181717?style=flat-square&logo=github)](https://github.com/AbdulAzeemHashmi)

</div>
