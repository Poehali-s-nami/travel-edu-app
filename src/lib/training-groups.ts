import type { AccessUser } from "@/types/access-user";
import type { TrainingGroup } from "@/types/training-group";

export function officeGroupId(officeId: string) {
  const bytes = new TextEncoder().encode(officeId.trim());
  return `office_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function belongsToGroup(user: Pick<AccessUser, "groupIds" | "officeIds">, group: TrainingGroup) {
  return Boolean(user.groupIds?.includes(group.id) ||
    (group.kind === "office" && group.officeId && user.officeIds?.includes(group.officeId)));
}

export function assignedGroupContent(user: Pick<AccessUser, "groupIds" | "officeIds">, groups: TrainingGroup[]) {
  const assigned = groups.filter((group) => !group.archived && belongsToGroup(user, group));
  return {
    groups: assigned,
    trackIds: [...new Set(assigned.flatMap((group) => group.trackIds))],
    materialIds: [...new Set(assigned.flatMap((group) => group.materialIds))]
  };
}
