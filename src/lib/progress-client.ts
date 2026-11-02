import type { User } from "firebase/auth";

export async function completeMaterialProgress(user: User, materialId: string) {
  const response = await fetch("/api/progress/complete", {
    method: "POST",
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ materialId })
  });
  if (!response.ok) throw new Error(`Progress completion failed: ${response.status}`);
}
