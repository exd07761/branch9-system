// ---------------------------------------------------------------------------
// Role-Based Access Control — the single source of truth for "who can do
// what." Pure logic only: no Firestore, no DOM. Every page imports can()
// from here instead of comparing role strings itself, so a role's
// permissions are defined in exactly one place.
//
// This is a UI/UX layer only. It controls what's shown and what this app's
// own code will attempt — it is NOT the security boundary. The actual
// enforcement lives in Firestore Security Rules (see README.md, "Firestore
// Security Rules for RBAC"), which re-derive a user's role from their own
// `users/{uid}` document server-side. A user who edits the page's JS in
// their browser can still only do what the deployed rules allow.
// ---------------------------------------------------------------------------

export const ROLES = {
  ADMINISTRATOR: "administrator",
  BRANCH_CLERK: "branch_clerk",
  ENCODER: "encoder",
  READ_ONLY: "read_only",
};

// If a `users/{uid}` document has no role field yet (or doesn't exist yet),
// every existing account should keep working exactly as it did before this
// milestone — Branch Clerk is that role (full day-to-day operational
// access, no user management).
export const DEFAULT_ROLE = ROLES.BRANCH_CLERK;

export const ALL_ROLES = [ROLES.ADMINISTRATOR, ROLES.BRANCH_CLERK, ROLES.ENCODER, ROLES.READ_ONLY];

export const ROLE_LABELS = {
  [ROLES.ADMINISTRATOR]: "Administrator",
  [ROLES.BRANCH_CLERK]: "Branch Clerk",
  [ROLES.ENCODER]: "Encoder",
  [ROLES.READ_ONLY]: "Read Only",
};

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",
  HEARINGS_VIEW: "hearings.view", // page access, search, Quick View
  HEARINGS_CREATE: "hearings.create",
  HEARINGS_EDIT: "hearings.edit",
  HEARINGS_DELETE: "hearings.delete",
  CALENDAR_VIEW: "calendar.view",
  REPORTS_VIEW: "reports.view",
  EXPORT: "export", // Word/CSV export actions, on both Hearings and Reports
  ACTIVITY_LOG_VIEW: "activityLog.view",
  USERS_MANAGE: "users.manage",
  // Not wired to any page yet — reserved so the Archive and Backup
  // milestones can call can(role, PERMISSIONS.ARCHIVE_MANAGE) /
  // BACKUP_MANAGE directly instead of adding new permission plumbing.
  ARCHIVE_MANAGE: "archive.manage",
  BACKUP_MANAGE: "backup.manage",
};

// The permission matrix. This is the only place role->permission mappings
// are listed — every page checks against this via can(), never against a
// role string directly.
const ROLE_PERMISSIONS = {
  [ROLES.ADMINISTRATOR]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.HEARINGS_VIEW,
    PERMISSIONS.HEARINGS_CREATE,
    PERMISSIONS.HEARINGS_EDIT,
    PERMISSIONS.HEARINGS_DELETE,
    PERMISSIONS.CALENDAR_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.EXPORT,
    PERMISSIONS.ACTIVITY_LOG_VIEW,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.ARCHIVE_MANAGE,
    PERMISSIONS.BACKUP_MANAGE,
  ],
  [ROLES.BRANCH_CLERK]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.HEARINGS_VIEW,
    PERMISSIONS.HEARINGS_CREATE,
    PERMISSIONS.HEARINGS_EDIT,
    PERMISSIONS.HEARINGS_DELETE,
    PERMISSIONS.CALENDAR_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.EXPORT,
    PERMISSIONS.ACTIVITY_LOG_VIEW,
  ],
  [ROLES.ENCODER]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.HEARINGS_VIEW,
    PERMISSIONS.HEARINGS_CREATE,
    PERMISSIONS.HEARINGS_EDIT,
    PERMISSIONS.CALENDAR_VIEW,
  ],
  [ROLES.READ_ONLY]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.HEARINGS_VIEW,
    PERMISSIONS.CALENDAR_VIEW,
    PERMISSIONS.REPORTS_VIEW,
  ],
};

/**
 * Does `role` have `permission`? Unknown/missing roles are treated as
 * DEFAULT_ROLE, the same safe fallback used when loading a user's role
 * from Firestore — this function never throws on a bad role string.
 */
export function can(role, permission) {
  const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[DEFAULT_ROLE];
  return perms.includes(permission);
}
