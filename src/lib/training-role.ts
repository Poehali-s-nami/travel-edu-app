import roleTokens from "@/config/training-role-tokens.json";
import type { TrainingRole } from "@/types/access-user";

const normalizeToken = (token: string) =>
  token.normalize("NFKC").trim().replace(/\s+/g, " ").replace(/ KZ$/i, "").toLocaleLowerCase();
const tokenSet = (tokens: string[]) => new Set(tokens.map(normalizeToken));

const priorityEmployee = tokenSet(roleTokens.priorityEmployee);
const head = tokenSet(roleTokens.head);
const manager = tokenSet(roleTokens.manager);
const partner = tokenSet(roleTokens.partner);
const employee = tokenSet(roleTokens.employee);
const known = new Set([...priorityEmployee, ...head, ...manager, ...partner, ...employee, ...tokenSet(roleTokens.admin)]);

export function classifyTrainingRole(values: string[]) {
  const tokens = values.flatMap((value) => value.split(",")).map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean);
  const normalized = tokens.map(normalizeToken);
  const has = (dictionary: Set<string>) => normalized.some((token) => dictionary.has(token));
  const role: TrainingRole = has(priorityEmployee) ? "EMPLOYEE"
    : has(head) ? "HEAD"
    : has(manager) ? "MANAGER"
    : has(partner) ? "PARTNER"
    : has(employee) ? "EMPLOYEE"
    : "MANUAL_REVIEW";

  return { role, unknownTokens: tokens.filter((_, index) => !known.has(normalized[index])) };
}
