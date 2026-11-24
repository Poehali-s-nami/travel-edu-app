export type ImportFileIdentity = {
  fileKey: string;
  fileName: string;
  fileSize: number;
  recordCount: number;
};

export type ImportCheckpointIdentity = {
  fileKey: string;
  fileName?: string;
  fileSize?: number;
  recordCount?: number;
};

function hashImportValue(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildImportFileKey(logicalContents: unknown, recordCount: number) {
  return `v2:${hashImportValue(JSON.stringify(logicalContents))}:${recordCount}`;
}

export function checkpointMatchesFile(
  checkpoint: ImportCheckpointIdentity,
  identity: ImportFileIdentity
) {
  if (checkpoint.fileKey === identity.fileKey) return true;

  if (
    checkpoint.fileName === identity.fileName &&
    checkpoint.fileSize === identity.fileSize &&
    checkpoint.recordCount === identity.recordCount
  ) {
    return true;
  }

  // Version 1 used name:size:lastModified:recordCount. File pickers can change
  // lastModified when the same file is selected again, so it is ignored here.
  const legacyParts = checkpoint.fileKey.split(":");
  if (legacyParts.length < 4) return false;
  const recordCount = Number(legacyParts[legacyParts.length - 1]);
  const fileSize = Number(legacyParts[legacyParts.length - 3]);
  const fileName = legacyParts.slice(0, -3).join(":");
  return fileName === identity.fileName &&
    fileSize === identity.fileSize &&
    recordCount === identity.recordCount;
}
