# Responsible AI Policy - WorkSync Project

## Principles & Guidelines

1. **No Sensitive Data Exposure**:
   - Never commit passwords, API keys, credentials, or personal private data to repository files or AI prompts.
   - All API keys are injected strictly through environment variables and masked in the UI.

2. **Code Verification & Manual Testing**:
   - AI-generated code must never be accepted blindly. Every component and state handler must be manually tested and verified locally.

3. **Security & Data Integrity Safeguards**:
   - Deletion operations must protect related resources (e.g., active task reassignment safety checks before user deletion).
   - Core administrative permissions must enforce sole-active-admin safeguards.

4. **Design Consistency**:
   - Respect the application's design system, global theme, and background colors without unintended style regressions.
