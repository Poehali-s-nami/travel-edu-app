export type TrainingGroup = {
  id: string;
  name: string;
  kind: "manual" | "office";
  officeId?: string;
  trackIds: string[];
  materialIds: string[];
  archived: boolean;
};
