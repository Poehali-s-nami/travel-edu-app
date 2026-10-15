import { officeGroupId } from "@/lib/training-groups";
import type { ContentAudience } from "@/types/material";

export const AUDIENCE_ROLES = ["HEAD", "MANAGER", "EMPLOYEE", "PARTNER"] as const;

export function canAccessContent(
  audience: ContentAudience | undefined,
  user: { trainingRole?: string; groupIds?: string[]; officeIds?: string[] },
  activeGroupIds: ReadonlySet<string>
) {
  if (!audience) return true;
  if (audience.mode !== "everyone" && audience.mode !== "restricted") return false;
  if (audience.mode === "everyone") return true;

  const roles = Array.isArray(audience.roles) ? audience.roles : [];
  const groups = Array.isArray(audience.groupIds) ? audience.groupIds : [];
  if (roles.includes(user.trainingRole as typeof roles[number])) return true;

  const memberships = new Set([
    ...(user.groupIds ?? []),
    ...(user.officeIds ?? []).map(officeGroupId)
  ]);
  return groups.some((id) => activeGroupIds.has(id) && memberships.has(id));
}
