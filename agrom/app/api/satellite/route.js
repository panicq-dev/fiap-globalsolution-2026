import { NextResponse } from "next/server";
import { getGeometryCenter, loadFarmConfig } from "../../../lib/farm-config.js";

const indices = new Set(["NDVI", "NDWI", "EVI"]);
const periods = { "7 dias": 7, "30 dias": 30, Safra: 120 };

function createEvalscript(index) {
  const formula = {
    NDVI: "(sample.B08 - sample.B04) / (sample.B08 + sample.B04 + 0.000001)",
    NDWI: "(sample.B03 - sample.B08) / (sample.B03 + sample.B08 + 0.000001)",
    EVI: "2.5 * (sample.B08 - sample.B04) / (sample.B08 + 6.0 * sample.B04 - 7.5 * sample.B02 + 1.0)",
  }[index];

  return `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "B08", "SCL", "dataMask"] }], output: { bands: 3, sampleType: "AUTO" } };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0 || [3, 6, 8, 9, 10, 11].includes(sample.SCL)) return [0, 0, 0];
  const value = ${formula};
  const stops = [
    [-0.2, [0.60, 0.24, 0.22]],
    [0.0, [0.83, 0.48, 0.28]],
    [0.25, [0.88, 0.75, 0.36]],
    [0.5, [0.63, 0.78, 0.40]],
    [0.75, [0.24, 0.56, 0.32]],
    [1.0, [0.10, 0.38, 0.25]]
  ];
  const normalized = Math.max(-0.2, Math.min(1.0, value));
  for (let i = 1; i < stops.length; i++) {
    if (normalized <= stops[i][0]) {
      const lower = stops[i - 1];
      const upper = stops[i];
      const ratio = (normalized - lower[0]) / (upper[0] - lower[0]);
      return lower[1].map((channel, index) => channel + ratio * (upper[1][index] - channel));
    }
  }
  return stops[stops.length - 1][1];
}`;
}

function createStatisticsEvalscript() {
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "indices", bands: ["NDVI", "NDWI", "EVI"], sampleType: "FLOAT32" },
      { id: "dataMask", bands: ["indices"] }
    ]
  };
}
function evaluatePixel(sample) {
  const mask = sample.dataMask * ([3, 6, 8, 9, 10, 11].includes(sample.SCL) ? 0 : 1);
  const ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04 + 0.000001);
  const ndwi = (sample.B03 - sample.B08) / (sample.B03 + sample.B08 + 0.000001);
  const evi = 2.5 * (sample.B08 - sample.B04) / (sample.B08 + 6.0 * sample.B04 - 7.5 * sample.B02 + 1.0);
  return {
    indices: [ndvi, ndwi, evi],
    dataMask: [mask]
  };
}`;
}

async function getSentinelToken() {
  const response = await fetch(
    "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SENTINEL_HUB_CLIENT_ID,
        client_secret: process.env.SENTINEL_HUB_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(20000),
    },
  );

  if (!response.ok) throw new Error("Não foi possível autenticar no Sentinel Hub.");
  return (await response.json()).access_token;
}

function getTimeRange(days) {
  const end = new Date();
  const currentStart = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - days * 2 * 24 * 60 * 60 * 1000);
  const iso = (date) => date.toISOString().replace(".000", "");

  return { start, currentStart, end, from: iso(start), to: iso(end) };
}

async function getFieldStatistics(accessToken, field, timeRange, intervalDays) {
  const response = await fetch("https://services.sentinel-hub.com/api/v1/statistics", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      input: {
        bounds: {
          geometry: field.geometry,
          properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
        },
        data: [{
          type: "sentinel-2-l2a",
          dataFilter: { maxCloudCoverage: 60, mosaickingOrder: "leastCC" },
        }],
      },
      aggregation: {
        timeRange: { from: timeRange.from, to: timeRange.to },
        aggregationInterval: { of: `P${intervalDays}D` },
        lastIntervalBehavior: "SHORTEN",
        evalscript: createStatisticsEvalscript(),
        resx: 10,
        resy: 10,
      },
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    console.error("Sentinel Hub statistics request failed:", response.status, await response.text());
    throw new Error("O Sentinel Hub não conseguiu calcular os índices para um dos talhões.");
  }

  return { field, data: (await response.json()).data ?? [] };
}

function aggregateStatistics(fieldResults, currentStart) {
  const buckets = new Map();

  for (const result of fieldResults) {
    for (const interval of result.data) {
      const key = `${interval.interval.from}|${interval.interval.to}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          from: interval.interval.from,
          to: interval.interval.to,
          indices: Object.fromEntries([...indices].map((index) => [index, { weightedSum: 0, sampleCount: 0, noDataCount: 0 }])),
        });
      }

      const bucket = buckets.get(key);
      for (const index of indices) {
        const stats = interval.outputs?.indices?.bands?.[index]?.stats;
        if (!stats || !Number.isFinite(stats.mean) || stats.sampleCount <= 0) continue;
        bucket.indices[index].weightedSum += stats.mean * stats.sampleCount;
        bucket.indices[index].sampleCount += stats.sampleCount;
        bucket.indices[index].noDataCount += stats.noDataCount ?? 0;
      }
    }
  }

  const series = [...buckets.values()]
    .sort((left, right) => left.from.localeCompare(right.from))
    .map((bucket) => ({
      from: bucket.from,
      to: bucket.to,
      indices: Object.fromEntries(Object.entries(bucket.indices).map(([index, totals]) => [
        index,
        totals.sampleCount > 0
          ? {
            mean: totals.weightedSum / totals.sampleCount,
            sampleCount: totals.sampleCount,
            validPercent: Math.round((totals.sampleCount / (totals.sampleCount + totals.noDataCount)) * 100),
          }
          : null,
      ])),
    }));

  const summarize = (selectedSeries, index) => {
    const values = selectedSeries.map((point) => point.indices[index]).filter(Boolean);
    const sampleCount = values.reduce((total, value) => total + value.sampleCount, 0);
    if (!sampleCount) return null;
    return {
      mean: values.reduce((total, value) => total + value.mean * value.sampleCount, 0) / sampleCount,
      sampleCount,
      observations: values.length,
    };
  };
  const summarizeField = (data, index, isCurrent) => {
    const values = data
      .filter((interval) => (new Date(interval.interval.to) > currentStart) === isCurrent)
      .map((interval) => interval.outputs?.indices?.bands?.[index]?.stats)
      .filter((stats) => stats && Number.isFinite(stats.mean) && stats.sampleCount > 0);
    const sampleCount = values.reduce((total, value) => total + value.sampleCount, 0);
    if (!sampleCount) return null;
    return {
      mean: values.reduce((total, value) => total + value.mean * value.sampleCount, 0) / sampleCount,
      sampleCount,
      observations: values.length,
    };
  };
  const currentSeries = series.filter((point) => new Date(point.to) > currentStart);
  const previousSeries = series.filter((point) => new Date(point.to) <= currentStart);
  const indicesSummary = Object.fromEntries([...indices].map((index) => [index, {
    current: summarize(currentSeries, index),
    previous: summarize(previousSeries, index),
  }]));
  const byField = fieldResults.map(({ field, data }) => ({
    id: field.id,
    name: field.name,
    areaHa: field.areaHa,
    crop: field.crop || null,
    sowingDate: field.sowingDate || null,
    indices: Object.fromEntries([...indices].map((index) => [index, {
      current: summarizeField(data, index, true),
      previous: summarizeField(data, index, false),
    }])),
    series: data.flatMap((interval) => {
      const observation = Object.fromEntries([...indices].map((index) => {
        const stats = interval.outputs?.indices?.bands?.[index]?.stats;
        return [index, stats && Number.isFinite(stats.mean) && stats.sampleCount > 0
          ? { mean: stats.mean, sampleCount: stats.sampleCount }
          : null];
      }));
      return Object.values(observation).some(Boolean)
        ? [{ from: interval.interval.from, to: interval.interval.to, indices: observation }]
        : [];
    }),
  }));

  return { series, indices: indicesSummary, byField };
}

async function getWeather(farm, selectedFields, days) {
  const totalArea = selectedFields.reduce((total, field) => total + field.areaHa, 0);
  const location = selectedFields.reduce((center, field) => {
    const point = getGeometryCenter(field.geometry);
    const weight = field.areaHa / totalArea;
    return {
      latitude: center.latitude + point.latitude * weight,
      longitude: center.longitude + point.longitude * weight,
    };
  }, { latitude: 0, longitude: 0 });
  const query = new URLSearchParams({
    latitude: location.latitude.toFixed(5),
    longitude: location.longitude.toFixed(5),
    daily: "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max,temperature_2m_min",
    past_days: String(Math.min(days, 92)),
    forecast_days: "1",
    timezone: "auto",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, {
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 10800 },
    });
    if (!response.ok) throw new Error("Open-Meteo indisponível.");
    const weather = await response.json();
    const cutoff = new Date(Date.now() - Math.min(days, 92) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const dates = weather.daily.time.map((date, index) => ({
      date,
      precipitation: weather.daily.precipitation_sum[index],
      et0: weather.daily.et0_fao_evapotranspiration[index],
      maxTemperature: weather.daily.temperature_2m_max[index],
      minTemperature: weather.daily.temperature_2m_min[index],
    })).filter((day) => day.date >= cutoff && day.date <= today);
    const maximums = dates.map((day) => day.maxTemperature).filter(Number.isFinite);
    const minimums = dates.map((day) => day.minTemperature).filter(Number.isFinite);

    return {
      source: "Open-Meteo · previsão e modelo meteorológico por grade",
      location: { latitude: weather.latitude, longitude: weather.longitude, label: farm.locationName || "Centro ponderado dos talhões" },
      days: dates,
      precipitationMm: dates.reduce((total, day) => total + (day.precipitation ?? 0), 0),
      evapotranspirationMm: dates.reduce((total, day) => total + (day.et0 ?? 0), 0),
      temperatureMaxC: maximums.length ? Math.max(...maximums) : null,
      temperatureMinC: minimums.length ? Math.min(...minimums) : null,
      periodDays: dates.length,
      periodStart: dates[0]?.date ?? null,
      periodEnd: dates.at(-1)?.date ?? null,
    };
  } catch (error) {
    console.error("Open-Meteo request failed:", error);
    return { error: "Não foi possível consultar o clima neste momento.", source: "Open-Meteo" };
  }
}

async function getIndexImage(accessToken, farm, selectedFields, index, timeRange) {
  const bounds = selectedFields.length === 1
    ? { geometry: selectedFields[0].geometry }
    : { bbox: farm.bounds };
  const imageTimeRange = {
    from: timeRange.currentStart.toISOString().replace(".000", ""),
    to: timeRange.end.toISOString().replace(".000", ""),
  };
  const response = await fetch("https://services.sentinel-hub.com/api/v1/process", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    },
    body: JSON.stringify({
      input: {
        bounds: { ...bounds, properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } },
        data: [{
          type: "sentinel-2-l2a",
          dataFilter: { timeRange: imageTimeRange, maxCloudCoverage: 60, mosaickingOrder: "mostRecent" },
        }],
      },
      output: { width: 768, height: 512, responses: [{ identifier: "default", format: { type: "image/png" } }] },
      evalscript: createEvalscript(index),
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error("Não foi possível gerar a imagem de índice do talhão.");
  return `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
}

export async function GET(request) {
  const searchParams = request.nextUrl.searchParams;
  const config = await loadFarmConfig();
  if (config.error) {
    const missing = [...config.missing];
    if (!process.env.SENTINEL_HUB_CLIENT_ID || !process.env.SENTINEL_HUB_CLIENT_SECRET) missing.push("Credenciais OAuth do Sentinel Hub");
    if (!process.env.GEMINI_API_KEY) missing.push("Chave da API Gemini para insights");
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("Armazenamento persistente Upstash para o agendamento de insights");
    return NextResponse.json({ ...config, missing }, { status: 409 });
  }

  const selectedFieldId = searchParams.get("field") || "all";
  const selectedFields = selectedFieldId === "all"
    ? config.farm.fields
    : config.farm.fields.filter((field) => field.id === selectedFieldId);
  const index = searchParams.get("index");
  const period = searchParams.get("period");
  const format = searchParams.get("format") || "image";

  if (selectedFields.length === 0 || !indices.has(index) || !periods[period] || !["image", "data"].includes(format)) {
    return NextResponse.json({ error: "Parâmetros de monitoramento inválidos." }, { status: 400 });
  }
  const days = periods[period];
  const timeRange = getTimeRange(days);
  const intervalDays = days <= 7 ? 1 : days <= 30 ? 5 : 10;
  const weather = await getWeather(config.farm, selectedFields, days);
  const responseFields = selectedFields.map(({ id, name, areaHa, crop, sowingDate, geometry }) => ({
    id, name, areaHa, crop: crop || null, sowingDate: sowingDate || null, geometry,
  }));
  const fieldCatalog = config.farm.fields.map(({ id, name, areaHa, crop, sowingDate }) => ({
    id, name, areaHa, crop: crop || null, sowingDate: sowingDate || null,
  }));
  const farmBounds = selectedFields.length === 1 ? selectedFields[0].bounds : config.farm.bounds;
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    if (format === "image") {
      return NextResponse.json({ error: "Configure as credenciais do Sentinel Hub para consultar imagens e índices reais." }, { status: 503 });
    }
    return NextResponse.json({
      farm: { name: config.farm.name, locationName: config.farm.locationName, bounds: farmBounds },
      fields: responseFields,
      fieldCatalog,
      period,
      weather,
      satellite: null,
      missing: ["Credenciais OAuth do Sentinel Hub"],
      generatedAt: new Date().toISOString(),
      status: "partial",
    });
  }

  try {
    const accessToken = await getSentinelToken();
    if (format === "image") {
      const image = await getIndexImage(accessToken, config.farm, selectedFields, index, timeRange);
      return NextResponse.json({ image, source: "Sentinel-2 L2A · Sentinel Hub" });
    }

    const fieldResults = await Promise.all(selectedFields.map((field) => getFieldStatistics(accessToken, field, timeRange, intervalDays)));
    const result = aggregateStatistics(fieldResults, timeRange.currentStart);
    const satellite = {
      source: "Sentinel-2 L2A · Sentinel Hub Statistical API",
      periodStart: timeRange.start.toISOString(),
      currentPeriodStart: timeRange.currentStart.toISOString(),
      periodEnd: timeRange.end.toISOString(),
      index: index,
      indices: result.indices,
      series: result.series,
      byField: result.byField,
      image: null,
    };

    if (searchParams.get("includeImage") !== "false") {
      try {
        satellite.image = await getIndexImage(accessToken, config.farm, selectedFields, index, timeRange);
      } catch (error) {
        satellite.imageError = error.message;
      }
    }

    return NextResponse.json({
      farm: { name: config.farm.name, locationName: config.farm.locationName, bounds: farmBounds },
      fields: responseFields,
      fieldCatalog,
      period,
      weather,
      satellite,
      missing: [],
      generatedAt: new Date().toISOString(),
      status: "ready",
    }, { headers: { "Cache-Control": "private, max-age=900" } });
  } catch (error) {
    console.error("Satellite monitoring request failed:", error);
    return NextResponse.json({ error: error.message || "Falha ao consultar dados de satélite." }, { status: 502 });
  }
}