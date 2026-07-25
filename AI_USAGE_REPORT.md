# AI Usage Report - Module 06: Team Members

**Intern Full Name:** Abdul Azeem Hashmi  
**GitHub Username:** AbdulAzeemHashmi  
**Email:** abdulazeemhashmi29@gmail.com  
**Assigned Module:** Team Members Management (Module 06)  
**AI Tools Used:** Antigravity AI, Claude 3.5 Sonnet, Cursor  

---

## 1. Prompting Techniques Applied

### Technique 1: Role-Based Prompting
- **Prompt Used:**  
  *"Act as a Senior Frontend & Security Architect. Build a modular Team Members management feature for a task management system. Ensure proper RBAC role badges (Admin, Team Lead, HR, Team Member), task assignment counter badges, and safety checks for member deletion."*
- **Purpose:** Guided the AI to adopt a security-conscious and clean component design pattern.

### Technique 2: Constraint-Based Prompting
- **Prompt Used:**  
  *"Strict Constraint: Do NOT modify global CSS (`index.css`), global background colors (`bg-[#090a0f]`), or main layout containers. Implement the Team Members component using existing glassmorphic styling tokens (`glass-panel`, `glass-button-neon`) without altering any theme variables."*
- **Purpose:** Guaranteed zero regression on existing UI themes and background colors.

### Technique 3: Debugging & Safety-Check Prompting
- **Prompt Used:**  
  *"Implement the Tricky Test requirement: When a user attempts to delete a team member, check if they have active assigned tasks. If active tasks exist, block instant deletion and display a safety modal requiring bulk task reassignment to another active member first. Explain how edge cases (e.g. deleting last admin or target user equal to source user) are handled."*
- **Purpose:** Ensured complete compliance with the assignment's tricky safety test.

---

## 2. AI Mistakes Identified & Manual Fixes Applied

| AI Mistake / Imperfection | Cause | Manual Fix Applied |
| :--- | :--- | :--- |
| **Silent Deletion of Assigned Tasks** | Initial AI logic deleted the user directly without validating task dependencies. | Wrote custom validation in `deleteTeamMember` in `AppContext.tsx` and created a mandatory Task Reassignment Safety Modal in `TeamMembersView.tsx`. |
| **Missing GitHub Handles** | Initial User interface lacked GitHub username fields. | Updated `User` interface in `types/index.ts` to include `githubUsername` and updated seed data in `fixtures.ts` for all 10 active interns. |
| **Hardcoded Color Overrides** | AI attempted to set background styling overrides. | Reverted inline style overrides and enforced standard `glass-panel` classes to preserve existing dark background (`bg-[#090a0f]`). |

---

## 3. Token Usage Summary

- **Input Tokens Estimated:** ~18,500
- **Output Tokens Estimated:** ~4,200
- **Total Token Budget:** ~22,700
- **Efficiency Note:** Used targeted file reading and focused prompts to minimize redundant context consumption.
