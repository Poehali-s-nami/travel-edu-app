import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const contentApiUrl = process.env.NEXT_PUBLIC_CONTENT_API_URL?.trim()
  || "https://api.psnhub.kz/v1/catalog";

export async function POST(request: NextRequest) {
  const bearer = request.headers.get("authorization") ?? "";
  if (!bearer.startsWith("Bearer ") || bearer.length > 10000) {
    return NextResponse.json({ message: "Требуется вход." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { materialId?: unknown };
    const materialId = typeof body.materialId === "string" ? body.materialId.trim() : "";
    if (!materialId || materialId.length > 512 || materialId.includes("/")) {
      return NextResponse.json({ message: "Некорректный материал." }, { status: 400 });
    }

    const response = await fetch(new URL("/v1/complete-progress", contentApiUrl), {
      method: "POST",
      headers: { authorization: bearer, "content-type": "application/json" },
      body: JSON.stringify({ materialId }),
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({ message: "Не удалось сохранить прогресс." }));
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    console.error("Progress completion failed", error);
    return NextResponse.json({ message: "Не удалось сохранить прогресс." }, { status: 503 });
  }
}
