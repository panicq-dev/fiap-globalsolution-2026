import { NextResponse } from "next/server";
import { getLatestInsight } from "../../../lib/insight-store.js";

export async function GET(request) {
  const checkedAt = new Date().toISOString();
  request.nextUrl.searchParams.get("refresh");
  const missing = [];
  if (!process.env.GEMINI_API_KEY) missing.push("Chave da API Gemini");
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("Armazenamento persistente Upstash Redis");

  if (missing.length > 0) {
    return NextResponse.json({ insight: null, status: "not_configured", missing, checkedAt }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const insight = await getLatestInsight();
    return NextResponse.json({ insight, status: insight ? "ready" : "waiting", checkedAt }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Insight read failed:", error);
    return NextResponse.json({ insight: null, status: "unavailable", error: "Não foi possível ler o insight salvo." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}