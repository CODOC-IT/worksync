# Manual Test Cases - Module 06: Team Members Management

**Module Owner:** Abdul Azeem Hashmi (Intern 6)  
**Target Component:** `TeamMembersView.tsx` & `AppContext.tsx`  

---

## Test Scenario 1: Team Members List & Stats Rendering
- **Objective:** Verify all 10 active interns and stats render accurately.
- **Steps:**
  1. Click **Team Members** in the left sidebar.
  2. Inspect the 4 top summary metric cards (Total Members, Active Members, Team Leads & HR, Active Workload).
  3. Verify grid view displays member avatars, roles, department, title, email, and GitHub handles (`@AbdulAzeemHashmi`, `@Salman-ahmed-2`, etc.).
- **Expected Result:** All metrics match seed state and member cards render cleanly without UI defects.

---

## Test Scenario 2: Adding a New Team Member
- **Objective:** Verify new member creation and LocalStorage persistence.
- **Steps:**
  1. Click **Add Team Member** button.
  2. Fill in Name ("Test Intern"), Email ("test.intern@codoc.com"), Role ("Team_Member"), Department ("Engineering").
  3. Click **Create Member**.
  4. Refresh the browser page.
- **Expected Result:** Member is added to list, toast/activity logged, and member persists after page refresh.

---

## Test Scenario 3: Tricky Safety Test - Deleting Member with Active Tasks
- **Objective:** Verify deletion safety check and bulk task reassignment workflow.
- **Steps:**
  1. Locate a member with active tasks (e.g. `Salman Ahmed` or `Abdul Azeem Hashmi`).
  2. Click the **Delete** icon on their member card.
  3. Observe the **Delete Member Safety Verification Modal**.
  4. Confirm that direct deletion is blocked with warning: *"TRICKY TEST SAFETY WARNING: ACTIVE TASKS FOUND!"*.
  5. Select a replacement active member from the dropdown (e.g., `Bilal Mughal`).
  6. Click **Reassign Tasks & Delete Member**.
- **Expected Result:** Tasks are transferred to `Bilal Mughal`, the original member is removed/deactivated, and activity log records the reassignment.

---

## Test Scenario 4: Search & Filtering
- **Objective:** Test search bar and role/status dropdown filters.
- **Steps:**
  1. Type "Azeem" in search bar -> Verify list filters to Abdul Azeem Hashmi.
  2. Select Role Filter "Team_Lead" -> Verify only Team Leads are shown.
  3. Select Status Filter "active" -> Verify active members display.
- **Expected Result:** Filters apply dynamically and return accurate results.
