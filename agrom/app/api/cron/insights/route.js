import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { findFieldAlerts } from "../../../../lib/field-analysis.js";
import { storeLatestInsight } from "../../../../lib/insight-store.js";
import { acquireInsightLock, getWorkspace, releaseInsightLock, storeWorkspace } from "../../../../lib/workspace-store.js";

const responseSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    summary: { type: "STRING" },
    observations: { type: "ARRAY", items: { type: "STRING" } },
    suggestedChecks: { type: "ARRAY", items: { type: "STRING" } },
    limitations: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["title", "summary", "observations", "suggestedChecks", "limitations"],
};

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") || "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function summarizeMeasurements(data) {
  const satellite = data.satellite;
  const indexNames = ["NDVI", "NDWI", "EVI"];
  const indices = Object.fromEntries(indexNames.map((index) => {
    const values = satellite.indices[index];
    const current = values.current;
    const previous = values.previous;
    const changePercent = current && previous && previous.mean !== 0
      ? ((current.mean - previous.mean) / Math.abs(previous.mean)) * 100
      : null;
    return [index, {
      currentMean: current?.mean ?? null,
      previousMean: previous?.mean ?? null,
      changePercent,
      currentPixels: current?.sampleCount ?? 0,
      previousPixels: previous?.sampleCount ?? 0,
    }];
  }));

  return {
    farm: data.farm.name,
    location: data.farm.locationName || null,
    period: data.period,
    periodStart: satellite.periodStart,
    periodEnd: satellite.periodEnd,
    source: satellite.source,
    indices,
    fieldAlerts: findFieldAlerts(satellite.byField, satellite.currentPeriodStart),
    weather: data.weather?.error ? null : {
      source: data.weather?.source,
      precipitationMm: data.weather?.precipitationMm ?? null,
      evapotranspirationMm: data.weather?.evapotranspirationMm ?? null,
      periodStart: data.weather?.periodStart ?? null,
      periodEnd: data.weather?.periodEnd ?? null,
    },
    knownLimitations: [
      "A média do talhão não localiza manchas pequenas dentro do polígono.",
      "Uma queda de índice mostra mudança na vegetação, não comprova praga, doença ou falha de irrigação.",
      "O clima vem de uma grade regional e pode diferir de uma estação dentro da fazenda.",
    ],
  };
}

async function generateTextInsight(measurements) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: "Você ajuda agricultores a interpretar medições. Use somente os dados recebidos. Não invente culturas, clima, datas ou causas. Nunca afirme que praga, doença ou falha de irrigação foi detectada apenas por índices de satélite. Escreva em português simples, separe observação de hipótese e sugira verificações seguras no campo, sem recomendar produtos químicos." }],
      },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(measurements) }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 700,
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    console.error("Gemini insight request failed:", response.status, await response.text());
    throw new Error("O Gemini não conseguiu gerar o insight.");
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("O Gemini retornou um insight vazio.");
  const parsed = JSON.parse(text);
  if (typeof parsed.title !== "string" || typeof parsed.summary !== "string") {
    throw new Error("O Gemini retornou um formato de insight inválido.");
  }
  return parsed;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  const missing = [];
  if (!process.env.SENTINEL_HUB_CLIENT_ID || !process.env.SENTINEL_HUB_CLIENT_SECRET) missing.push("Credenciais do Sentinel Hub");
  if (!process.env.GEMINI_API_KEY) missing.push("Chave da API Gemini");
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("Armazenamento Upstash Redis");
  if (missing.length > 0) return NextResponse.json({ error: "Faltam integrações para gerar insights.", missing }, { status: 503 });

  let lockId;
  try {
    const workspace = await getWorkspace();
    if (!workspace?.profile || !workspace?.schedule?.frequencyHours) {
      return NextResponse.json({ error: "Conclua o cadastro inicial antes de gerar insights." }, { status: 409 });
    }

    const now = new Date();
    const nextRunAt = workspace.schedule.nextRunAt ? new Date(workspace.schedule.nextRunAt) : now;
    if (Number.isFinite(nextRunAt.getTime()) && nextRunAt > now) {
      return NextResponse.json({ status: "not_due", nextRunAt: nextRunAt.toISOString() });
    }

    lockId = randomUUID();
    if (!(await acquireInsightLock(lockId))) {
      return NextResponse.json({ status: "already_running" }, { status: 202 });
    }

    const satelliteUrl = new URL("/api/satellite", request.url);
    satelliteUrl.search = new URLSearchParams({ field: "all", index: "NDVI", period: "30 dias", format: "data", includeImage: "false" }).toString();
    const satelliteResponse = await fetch(satelliteUrl, { cache: "no-store", signal: AbortSignal.timeout(60000) });
    const data = await satelliteResponse.json();

    if (!satelliteResponse.ok) {
      return NextResponse.json({ error: data.error || "Não foi possível ler os dados da fazenda.", missing: data.missing }, { status: satelliteResponse.status });
    }
    if (!data.satellite) {
      return NextResponse.json({ error: "Ainda não há estatísticas Sentinel-2 para analisar.", missing: data.missing }, { status: 503 });
    }

    const measurements = summarizeMeasurements(data);
    if (measurements.indices.NDVI.currentMean === null) {
      return NextResponse.json({ error: "Não há pixels Sentinel-2 válidos no período selecionado." }, { status: 422 });
    }

    const generatedAt = new Date().toISOString();
    const ai = await generateTextInsight(measurements);
    const insight = {
      generatedAt,
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      source: "Gemini · análise de medições Sentinel-2 e clima Open-Meteo",
      ...ai,
      systemAnalysis: measurements,
    };
    await storeLatestInsight(insight);
    const completedAt = new Date();
    await storeWorkspace({
      ...workspace,
      schedule: {
        ...workspace.schedule,
        lastRunAt: completedAt.toISOString(),
        nextRunAt: new Date(completedAt.getTime() + workspace.schedule.frequencyHours * 60 * 60 * 1000).toISOString(),
      },
      updatedAt: completedAt.toISOString(),
    });

    return NextResponse.json({ status: "generated", insight, nextRunAt: new Date(completedAt.getTime() + workspace.schedule.frequencyHours * 60 * 60 * 1000).toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Scheduled insight generation failed:", error);
    return NextResponse.json({ error: error.message || "Não foi possível atualizar o insight." }, { status: 502 });
  } finally {
    if (lockId) {
      try {
        await releaseInsightLock(lockId);
      } catch (error) {
        console.error("Scheduled insight lock cleanup failed:", error);
      }
    }
  }
}