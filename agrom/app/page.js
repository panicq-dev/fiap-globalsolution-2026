"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { findFieldAlerts } from "../lib/field-analysis.js";

const indexDetails = {
  NDVI: {
    label: "Vigor das plantas",
    short: "O satélite mede a luz refletida pelas plantas. Valores mais altos costumam indicar vegetação mais verde. Sozinho, o índice não confirma doença ou praga.",
    technical: "NDVI = (infravermelho próximo - vermelho) / (infravermelho próximo + vermelho).",
  },
  NDWI: {
    label: "Água na vegetação",
    short: "Ajuda a acompanhar mudanças de água nas plantas. O resultado varia com o tipo de cultivo, o solo e a época do ano.",
    technical: "NDWI = (verde - infravermelho próximo) / (verde + infravermelho próximo).",
  },
  EVI: {
    label: "Vigor em vegetação densa",
    short: "É parecido com o NDVI e foi ajustado para observar áreas com vegetação mais fechada.",
    technical: "EVI usa as bandas azul, vermelha e infravermelho próximo para reduzir efeitos da atmosfera e do solo.",
  },
};

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
    field: <><path d="m3 7 6-4 6 4 6-4v14l-6 4-6-4-6 4zM9 3v14M15 7v14" /></>,
    alert: <><path d="M12 3 2.8 19a1.2 1.2 0 0 0 1 1.8h16.4a1.2 1.2 0 0 0 1-1.8z" /><path d="M12 9v4M12 17h.01" /></>,
    chart: <><path d="M3 3v18h18M8 15l4-4 4 3 5-7" /></>,
    cloud: <><path d="M20 16.2A4.8 4.8 0 0 0 18 7h-1.2A7 7 0 1 0 4 15.3" /><path d="m9 15 3 3 5-6" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 17 6.5L20 12M4 12l3 5.5A7 7 0 0 0 18.5 15" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
  };

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function getTileCoordinates(lat, lon, zoom) {
  const scale = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * scale);
  const radians = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * scale);
  return { x, y };
}

function getRings(geometry) {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat(1);
}

function SatelliteMap({ farm, fields, satelliteImage, selectedFieldId }) {
  if (!farm?.bounds || fields.length === 0) return null;

  const [west, south, east, north] = farm.bounds;
  const zoom = selectedFieldId === "all" ? 13 : 15;
  const center = getTileCoordinates((south + north) / 2, (west + east) / 2, zoom);
  const tiles = [];

  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) {
      const x = center.x + column;
      const y = center.y + row;
      tiles.push(
        <div
          className="map-tile"
          key={`${x}-${y}`}
          style={{ backgroundImage: `url(https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x})` }}
        />,
      );
    }
  }

  const projectRing = (ring) => ring.map(([longitude, latitude]) => {
    const x = ((longitude - west) / (east - west || 1)) * 700;
    const y = ((north - latitude) / (north - south || 1)) * 420;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="satellite-map">
      <div className="tile-grid">{tiles}</div>
      {satelliteImage && <div className="sentinel-layer" style={{ backgroundImage: `url(${satelliteImage})` }} role="img" aria-label="Índice calculado com imagens Sentinel-2" />}
      <div className="map-shade" />
      <svg className="field-boundaries" viewBox="0 0 700 420" preserveAspectRatio="none" aria-label="Limites cadastrados dos talhões">
        {fields.map((field) => getRings(field.geometry).map((ring, ringIndex) => <polygon key={`${field.id}-${ringIndex}`} className={`field-outline ${selectedFieldId === field.id ? "field-outline-active" : "field-outline-muted"}`} points={projectRing(ring)} />))}
      </svg>
      {fields.map((field) => {
        const positions = getRings(field.geometry).flat();
        const longitude = positions.reduce((sum, point) => sum + point[0], 0) / positions.length;
        const latitude = positions.reduce((sum, point) => sum + point[1], 0) / positions.length;
        const left = ((longitude - west) / (east - west || 1)) * 100;
        const top = ((north - latitude) / (north - south || 1)) * 100;
        return <span className={`map-label ${selectedFieldId === field.id ? "map-label-active" : ""}`} style={{ left: `${left}%`, top: `${top}%` }} key={field.id}>{field.name}</span>;
      })}
      <span className="map-coordinate"><Icon name="pin" size={13} /> {farm.locationName || "Centro dos talhões"}</span>
      <span className="map-attribution">{satelliteImage ? "Índice Sentinel-2 · Sentinel Hub" : "Imagem base · Esri World Imagery"}</span>
      <button className="map-layer-button" type="button" title="Camadas do mapa" aria-label="Camadas do mapa"><Icon name="layers" /></button>
      <div className="map-legend"><span className="legend-dot healthy" /> Índice vegetal <span className="legend-dot attention" /> Limite do talhão</div>
    </div>
  );
}

function formatValue(value, digits = 2) {
  return Number.isFinite(value)
    ? value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "Sem leitura";
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(value));
}

function TrendChart({ series, index }) {
  const points = series.map((item) => ({ date: item.to, value: item.indices[index]?.mean })).filter((item) => Number.isFinite(item.value));
  if (points.length < 2) return <div className="chart-empty" role="status">São necessárias pelo menos duas imagens válidas para mostrar a evolução.</div>;

  const values = points.map((point) => point.value);
  const minimum = Math.min(...values, -0.1);
  const maximum = Math.max(...values, 0.1);
  const range = maximum - minimum || 1;
  const chartPoints = points.map((point, indexPoint) => `${(indexPoint / (points.length - 1)) * 100},${52 - ((point.value - minimum) / range) * 44}`).join(" ");

  return (
    <div className="chart-wrap">
      <svg className="trend-chart" viewBox="0 0 100 58" preserveAspectRatio="none" role="img" aria-label={`Variação real de ${index} em ${points.length} observações Sentinel-2`}>
        <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#65d494" stopOpacity=".23" /><stop offset="100%" stopColor="#65d494" stopOpacity="0" /></linearGradient></defs>
        {[14, 28, 42].map((line) => <line key={line} className="chart-gridline" x1="0" y1={line} x2="100" y2={line} />)}
        <polygon className="chart-fill" points={`0,58 ${chartPoints} 100,58`} />
        <polyline className="chart-line" points={chartPoints} />
      </svg>
      <div className="chart-dates"><span>{formatDate(points[0].date)}</span><span>{formatDate(points[Math.floor(points.length / 2)].date)}</span><span>{formatDate(points.at(-1).date)}</span></div>
    </div>
  );
}

function AlertItem({ alert }) {
  return (
    <article className="alert-item">
      <span className="alert-indicator warning"><Icon name="alert" size={15} /></span>
      <div className="alert-copy"><div className="alert-heading"><strong>Queda no vigor médio</strong><time>{formatDate(alert.current.date)}</time></div><p>{alert.fieldName} <span>·</span> NDVI caiu {Math.abs(alert.change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% entre observações.</p></div>
      <span className="priority-label warning">Verificar no campo</span>
    </article>
  );
}

function FarmSetup({ initial, setupError, onComplete }) {
  const [fullName, setFullName] = useState(initial?.profile?.fullName ?? "");
  const [email, setEmail] = useState(initial?.profile?.email ?? "");
  const [farmName, setFarmName] = useState(initial?.farm?.name ?? "");
  const [locationName, setLocationName] = useState(initial?.farm?.locationName ?? "");
  const [frequencyHours, setFrequencyHours] = useState(String(initial?.schedule?.frequencyHours ?? 3));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [uploadedFarm, setUploadedFarm] = useState(null);
  const fields = uploadedFarm?.fields ?? initial?.farm?.fields ?? [];
  const area = fields.reduce((total, field) => total + field.areaHa, 0);

  async function importFields(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setFormError("O arquivo deve ter no máximo 2 MB.");
      return;
    }
    try {
      const farm = JSON.parse(await file.text());
      if (!Array.isArray(farm.fields) || farm.fields.length === 0) throw new Error("O arquivo precisa conter a lista de talhões e geometrias GeoJSON.");
      setUploadedFarm(farm);
      setFarmName(farm.farmName || farmName);
      setLocationName(farm.locationName || locationName);
      setFormError("");
    } catch (error) {
      setUploadedFarm(null);
      setFormError(error instanceof SyntaxError ? "O arquivo não é um JSON válido." : error.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, farmName, locationName, frequencyHours: Number(frequencyHours), ...(uploadedFarm ? { farm: { ...uploadedFarm, farmName, locationName } } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFormError(result.error || "Não foi possível salvar o cadastro.");
        return;
      }
      onComplete(result);
    } catch {
      setFormError("Não foi possível acessar o servidor. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="dashboard-app setup-screen">
      <header className="top-header">
        <a className="header-brand" href="#setup" aria-label="Agrom"><Image src="/agrom-logo.png" alt="Agrom" width={130} height={73} priority /></a>
        <div className="header-actions"><span className="data-status status-pending"><i /> Primeiro acesso</span></div>
      </header>
      <div className="setup-content" id="setup">
        <p className="section-kicker">CONFIGURAÇÃO INICIAL</p>
        <h1>Vamos preparar sua fazenda</h1>
        <p className="setup-intro">Informe quem acompanha os dados e de quanto em quanto tempo quer receber um novo insight.</p>
        <div className="setup-private-note"><Icon name="alert" size={16} /><span>Este é um perfil do app, não uma conta com senha. Mantenha o acesso ao app privado na Vercel.</span></div>
        {setupError && <p className="request-error" role="alert">{setupError}</p>}
        <form className="setup-form" onSubmit={submit}>
          <section className="setup-section"><h2>Responsável</h2><div className="setup-fields"><label>Nome completo<input autoComplete="name" maxLength={80} required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Seu nome" /></label><label>Email<input autoComplete="email" maxLength={254} required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@fazenda.com" /></label></div></section>
          <section className="setup-section"><h2>Fazenda</h2><div className="setup-fields"><label>Nome da fazenda<input maxLength={100} required value={farmName} onChange={(event) => setFarmName(event.target.value)} /></label><label>Município e estado<input maxLength={100} value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Ex.: Município, UF" /></label></div><p className="setup-field-summary">{fields.length ? `${fields.length} ${fields.length === 1 ? "talhão cadastrado" : "talhões cadastrados"} · ${area.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha` : "O cadastro GeoJSON ainda é necessário para mostrar talhões e índices."}</p><label className="setup-upload">Cadastro dos talhões (JSON)<input type="file" accept="application/json,.json" onChange={importFields} /><small>{uploadedFarm ? "Arquivo selecionado para importar ao salvar" : initial?.farm?.fields?.length ? "Já carregado neste servidor. Escolha um arquivo para substituir." : "Selecione o arquivo fields.json do seu computador."}</small></label></section>
          <section className="setup-section"><h2>Insight automático</h2><label className="schedule-select">Gerar análise a cada<select value={frequencyHours} onChange={(event) => setFrequencyHours(event.target.value)}><option value="3">3 horas</option><option value="6">6 horas</option><option value="12">12 horas</option><option value="24">24 horas</option></select></label><p className="setup-schedule-note">Este projeto agenda o cron a cada 3 horas e precisa de Vercel Pro. No Hobby, altere também a agenda da implantação para uma vez por dia.</p></section>
          {formError && <p className="request-error" role="alert">{formError}</p>}
          {!initial?.storageAvailable && <p className="request-error" role="alert">Configure o armazenamento persistente Upstash no servidor antes de salvar.</p>}
          <button className="setup-submit" type="submit" disabled={saving || fields.length === 0 || !initial?.storageAvailable}>{saving ? "Salvando…" : "Salvar e abrir a visão geral"}</button>
        </form>
      </div>
    </main>
  );
}

export default function Home() {
  const [selectedFieldId, setSelectedFieldId] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState("NDVI");
  const [period, setPeriod] = useState("30 dias");
  const [dashboardData, setDashboardData] = useState(null);
  const [setupError, setSetupError] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadId, setReloadId] = useState(0);
  const [insightResponse, setInsightResponse] = useState(null);
  const [insightStatus, setInsightStatus] = useState("loading");
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const analysisDialog = useRef(null);
  const [workspaceSetup, setWorkspaceSetup] = useState(null);
  const [workspaceSetupLoading, setWorkspaceSetupLoading] = useState(true);
  const [workspaceSetupError, setWorkspaceSetupError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadDashboard() {
      setLoading(true);
      setRequestError("");
      try {
        const query = new URLSearchParams({ field: selectedFieldId, index: selectedIndex, period, format: "data" });
        const response = await fetch(`/api/satellite?${query}`, { signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 409) {
          setDashboardData(null);
          setSetupError(result);
        } else if (!response.ok) {
          setRequestError(result.error || "Não foi possível carregar os dados.");
        } else {
          setDashboardData(result);
          setSetupError(null);
        }
      } catch {
        if (!controller.signal.aborted) setRequestError("Não foi possível acessar as fontes de dados. Tente novamente.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, [selectedFieldId, selectedIndex, period, reloadId]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadInsight() {
      try {
        const response = await fetch("/api/insights", { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (controller.signal.aborted) return;
        setInsightResponse(result);
        setInsightStatus(result.status || (response.ok ? "ready" : "unavailable"));
      } catch {
        if (!controller.signal.aborted) setInsightStatus("unavailable");
      }
    }

    loadInsight();
    const refreshTimer = window.setInterval(loadInsight, 15 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadWorkspaceSetup() {
      try {
        const response = await fetch("/api/setup", { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) setWorkspaceSetupError(result.error || "Não foi possível carregar o cadastro inicial.");
        setWorkspaceSetup(result);
      } catch {
        if (!controller.signal.aborted) setWorkspaceSetupError("Não foi possível acessar o servidor.");
      } finally {
        if (!controller.signal.aborted) setWorkspaceSetupLoading(false);
      }
    }

    loadWorkspaceSetup();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const dialog = analysisDialog.current;
    if (!dialog) return;
    if (analysisOpen && !dialog.open) dialog.showModal();
    if (!analysisOpen && dialog.open) dialog.close();
  }, [analysisOpen]);

  const fieldCatalog = dashboardData?.fieldCatalog ?? [];
  const selectedFields = dashboardData?.fields ?? [];
  const selectedCatalog = selectedFieldId === "all" ? fieldCatalog : fieldCatalog.filter((field) => field.id === selectedFieldId);
  const satellite = dashboardData?.satellite;
  const weather = dashboardData?.weather;
  const indexStats = satellite?.indices?.[selectedIndex];
  const currentValue = indexStats?.current?.mean;
  const previousValue = indexStats?.previous?.mean;
  const change = Number.isFinite(currentValue) && Number.isFinite(previousValue) && previousValue !== 0
    ? ((currentValue - previousValue) / Math.abs(previousValue)) * 100
    : null;
  const area = selectedCatalog.reduce((total, field) => total + field.areaHa, 0);
  const fieldAlerts = satellite?.byField ? findFieldAlerts(satellite.byField, satellite.currentPeriodStart) : [];
  const allMissing = [...(setupError?.missing ?? dashboardData?.missing ?? []), ...(insightResponse?.missing ?? [])];
  const seenIntegrations = new Set();
  const missing = allMissing.filter((item) => {
    const text = item.toLowerCase();
    const integration = text.includes("gemini") ? "gemini" : text.includes("upstash") ? "upstash" : null;
    if (!integration) return true;
    if (seenIntegrations.has(integration)) return false;
    seenIntegrations.add(integration);
    return true;
  });
  const latestInsight = insightResponse?.insight ?? null;
  const insightAnalysis = latestInsight?.systemAnalysis;
  const selectedName = selectedFieldId === "all"
    ? dashboardData?.farm?.name
    : fieldCatalog.find((field) => field.id === selectedFieldId)?.name;
  const formattedDate = dashboardData?.generatedAt
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(dashboardData.generatedAt))
    : "";

  if (workspaceSetupLoading) {
    return <main className="dashboard-app setup-loading" aria-busy="true"><Image src="/agrom-logo.png" alt="Agrom" width={130} height={73} priority /><p>Carregando o cadastro da fazenda…</p></main>;
  }

  if (!workspaceSetup?.setupComplete) {
    return <FarmSetup initial={workspaceSetup} setupError={workspaceSetupError} onComplete={(result) => { setWorkspaceSetup(result); setReloadId((value) => value + 1); }} />;
  }

  return (
    <main className="dashboard-app">
      <header className="top-header">
        <div className="brand-cluster">
          <a className="header-brand" href="#overview" aria-label="Agrom início"><Image src="/agrom-logo.png" alt="Agrom" width={130} height={73} priority /></a>
          <div className="header-farm"><span className="farm-avatar"><Icon name="field" size={16} /></span><span><strong>{dashboardData?.farm?.name || "Sua fazenda"}</strong><small>{dashboardData?.farm?.locationName || "Localização dos talhões"}</small></span><Icon name="chevron" size={14} /></div>
        </div>
        <nav className="header-nav" aria-label="Navegação principal"><a className="header-nav-item active" href="#overview" aria-current="page"><Icon name="grid" size={17} /><span>Visão geral</span></a></nav>
        <div className="header-actions"><span className={`data-status ${satellite ? "" : "status-pending"}`}><i /> {satellite ? "Dados Sentinel-2" : "Dados pendentes"}</span><span className="header-date"><Icon name="calendar" size={15} /> {formattedDate || "Aguardando dados"}</span></div>
      </header>

      <div className="dashboard-content" id="overview">
        <section className="greeting-row"><div><p className="breadcrumb">{dashboardData?.farm?.name || "Fazenda"} <span>/</span> Monitoramento</p><h1>Visão geral da lavoura</h1><p className="greeting-subtitle">Imagens de satélite, clima e mudanças observadas nos seus talhões.</p></div><div className="dashboard-filters"><label>Talhão<select value={selectedFieldId} onChange={(event) => setSelectedFieldId(event.target.value)} aria-label="Selecionar talhão" disabled={fieldCatalog.length === 0}><option value="all">Todos os talhões</option>{fieldCatalog.map((field) => <option value={field.id} key={field.id}>{field.name}</option>)}</select></label><label>Período<select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Selecionar período"><option>7 dias</option><option>30 dias</option><option>Safra</option></select></label><button className="refresh-button" onClick={() => setReloadId((value) => value + 1)} disabled={loading}><Icon name="refresh" size={15} /> Atualizar</button></div></section>

        {(setupError || missing.length > 0) && <section className="data-requirements" role="status"><strong>Para mostrar resultados reais, falta conectar:</strong><ul>{missing.map((item) => <li key={item}>{item}</li>)}{setupError?.error && <li>{setupError.error}</li>}</ul><p>O sistema não preenche esses dados com estimativas inventadas.</p></section>}
        {requestError && <p className="request-error" role="alert">{requestError}</p>}

        <section className="metric-grid summary-grid" aria-label="Resumo da lavoura" aria-busy={loading}>
          <article className="metric-card"><div className="metric-top"><span>VIGOR DAS PLANTAS · {selectedIndex}</span><span className="metric-symbol health-symbol"><Icon name="chart" size={17} /></span></div><div className="metric-value">{Number.isFinite(currentValue) ? formatValue(currentValue) : "—"}</div><div className="metric-bottom"><span className="metric-helper">{Number.isFinite(currentValue) ? "Média real da área" : selectedFields.length === 0 ? "Cadastre os limites dos talhões" : satellite ? "Sem imagem válida neste período" : "Configure o Sentinel Hub"}</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>MUDANÇA NO PERÍODO</span><span className="metric-symbol index-symbol"><Icon name="chart" size={17} /></span></div><div className="metric-value">{Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}</div><div className="metric-bottom"><span className="metric-helper">Comparado ao período anterior</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>ÁREA CADASTRADA</span><span className="metric-symbol area-symbol"><Icon name="field" size={17} /></span></div><div className="metric-value">{selectedCatalog.length ? area.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}<span className="metric-unit"> ha</span></div><div className="metric-bottom"><span className="metric-helper">{selectedCatalog.length ? `${selectedCatalog.length} ${selectedCatalog.length === 1 ? "talhão" : "talhões"} no cadastro` : "Cadastre a área dos talhões"}</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>CHUVA NO PERÍODO</span><span className="metric-symbol alert-symbol"><Icon name="cloud" size={17} /></span></div><div className="metric-value">{Number.isFinite(weather?.precipitationMm) ? weather.precipitationMm.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}<span className="metric-unit"> mm</span></div><div className="metric-bottom"><span className="metric-helper">{weather?.periodDays ? `${weather.periodDays} dias · Open-Meteo` : "Aguardando localização dos talhões"}</span></div></article>
        </section>

        <div className="main-grid dashboard-grid">
          <section className="panel map-panel" aria-busy={loading}><div className="map-panel-heading"><div><span className="section-kicker">VISÃO DA LAVOURA</span><h2>Mapa de vigor</h2><p>{satellite?.source || "Imagem base de satélite; índice real depende do Sentinel Hub"}</p></div><label className="index-select"><span className="visually-hidden">Índice de vegetação</span><select value={selectedIndex} onChange={(event) => setSelectedIndex(event.target.value)} aria-label="Índice de vegetação">{Object.keys(indexDetails).map((name) => <option key={name}>{name}</option>)}</select><Icon name="chevron" size={14} /></label></div>{selectedFields.length > 0 && <SatelliteMap farm={dashboardData.farm} fields={selectedFields} satelliteImage={satellite?.image} selectedFieldId={selectedFieldId} />}{selectedFields.length === 0 && <div className="map-empty" role="status">{loading ? "Carregando o cadastro da fazenda…" : "O mapa aparece depois de cadastrar os limites reais dos talhões."}</div>}<div className="map-footer"><div className="sync-status"><span className="sync-icon"><Icon name="cloud" size={17} /></span><span><strong>{satellite ? "Índice calculado com Sentinel-2" : "Índice ainda indisponível"}</strong><small>{satellite ? `Sentinel Hub · ${indexDetails[selectedIndex].label.toLowerCase()}` : "A imagem base não é um mapa de vigor"}</small></span></div><span className="map-source">Imagem: Esri · Índices: Sentinel Hub</span></div></section>
          <section className="panel trend-panel"><div className="trend-heading"><div><span className="section-kicker blue-kicker">DESEMPENHO</span><h2>{indexDetails[selectedIndex].label} ({selectedIndex})</h2><p>{period} · {selectedName || "talhões cadastrados"}</p></div></div><div className="trend-summary"><strong>{Number.isFinite(currentValue) ? formatValue(currentValue) : "—"}</strong><span className={Number.isFinite(change) && change < 0 ? "trend-negative" : "trend-positive"}>{Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "Sem comparação"}<small>vs. período anterior</small></span></div><TrendChart series={satellite?.series ?? []} index={selectedIndex} /><div className="baseline-note"><span className="baseline-icon"><Icon name="chart" size={15} /></span><span><strong>Como ler este resultado</strong><small>Mesma duração, logo antes do período atual</small></span><span className="baseline-value">{Number.isFinite(previousValue) ? formatValue(previousValue) : "—"}</span></div><details className="index-explanation"><summary>O que significa {selectedIndex}?</summary><p>{indexDetails[selectedIndex].short}</p><p className="technical-note">{indexDetails[selectedIndex].technical}</p></details></section>
        </div>

        <section className="insight-banner gemini-insight" aria-live="polite"><span className="insight-icon"><Icon name="chart" size={19} /></span><div><span className="insight-kicker">INSIGHT AGROM · GEMINI</span>{latestInsight ? <><h2>{latestInsight.title}</h2><p>{latestInsight.summary}</p><small>Atualizado {formatDate(latestInsight.generatedAt)} · próxima leitura automática em até 3 horas</small></> : <><h2>{insightStatus === "not_configured" ? "Insight automático ainda não conectado" : insightStatus === "unavailable" ? "Não foi possível carregar o último insight" : "Aguardando a primeira análise"}</h2><p>{insightStatus === "not_configured" ? "Configure a chave Gemini e o armazenamento Upstash. A execução automática acontece após publicar no Vercel." : "Quando as integrações estiverem prontas, o Gemini resume as medições reais a cada 3 horas."}</p></>}</div><button className="insight-action" onClick={() => setAnalysisOpen(true)} disabled={!latestInsight}>Ver análise <Icon name="arrow" size={15} /></button></section>

        <section className="system-insight" aria-live="polite"><span className="insight-icon"><Icon name="alert" size={18} /></span><div><span className="insight-kicker">ANÁLISE DO SISTEMA</span>{fieldAlerts.length > 0 ? <><h2>{fieldAlerts.length === 1 ? "Mudança importante em um talhão" : `Mudanças importantes em ${fieldAlerts.length} talhões`}</h2><p>O NDVI médio caiu pelo menos 10% entre janelas válidas no período selecionado em: {fieldAlerts.map((alert) => alert.fieldName).join(", ")}. Isso mostra uma mudança, mas não confirma a causa. Confira as imagens e visite o local.</p></> : <><h2>{satellite ? "Nenhuma queda média acentuada foi identificada" : "A análise aparece após conectar dados de satélite"}</h2><p>{satellite ? "O resumo compara médias dos talhões. Mudanças pequenas ou localizadas podem não aparecer nesta visão geral." : "Sem Sentinel Hub conectado, o sistema não cria alertas agronômicos."}</p></>}</div></section>

        <section className="panel alerts-panel" id="attention-panel"><div className="panel-header alerts-header"><div><span className="section-kicker attention-kicker">OBSERVAÇÕES MEDIDAS</span><h2>O que mudou nos talhões</h2></div><span className="alert-total">{satellite ? fieldAlerts.length : "—"}</span></div>{fieldAlerts.length > 0 ? <div className="alert-list">{fieldAlerts.map((alert) => <AlertItem key={alert.fieldId} alert={alert} />)}</div> : <p className="empty-alerts">{satellite ? "Não há queda média acima do limite definido nesta janela. Isso não descarta manchas pequenas no talhão." : "Alertas ficam indisponíveis até recebermos índices Sentinel-2 reais."}</p>}</section>

        {weather && <p className="weather-attribution">Clima: {weather.source}. Chuva acumulada: {formatValue(weather.precipitationMm, 1)} mm; evapotranspiração de referência: {formatValue(weather.evapotranspirationMm, 1)} mm. É uma estimativa de grade regional, não uma medição dentro do talhão.</p>}
        <footer className="dashboard-footer"><span>Agrom · Visão geral da lavoura</span><span>{satellite ? `${satellite.source} · ${formattedDate}` : "Dados agronômicos aguardando configuração"}</span></footer>
      </div>

      <dialog className="analysis-dialog" ref={analysisDialog} aria-labelledby="analysis-title" onClose={() => setAnalysisOpen(false)}>
        {latestInsight && <>
          <div className="analysis-dialog-header"><span className="section-kicker">ANÁLISE AGROM · GEMINI</span><button className="analysis-close" type="button" aria-label="Fechar análise" onClick={() => setAnalysisOpen(false)}>×</button></div>
          <h2 id="analysis-title">{latestInsight.title}</h2>
          <p className="analysis-summary">{latestInsight.summary}</p>
          <p className="analysis-timestamp">Gerado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(latestInsight.generatedAt))} · {latestInsight.model}</p>
          <section className="analysis-section"><h3>O que as medições mostram</h3><ul>{(latestInsight.observations || []).map((item, index) => <li key={`observation-${index}`}>{item}</li>)}</ul>{insightAnalysis && <div className="measurement-grid">{Object.entries(insightAnalysis.indices || {}).map(([name, values]) => <div key={name}><strong>{name}</strong><span>Agora: {formatValue(values.currentMean)}</span><span>Antes: {formatValue(values.previousMean)}</span><span>Variação: {Number.isFinite(values.changePercent) ? `${values.changePercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "Sem comparação"}</span></div>)}</div>}</section>
          <section className="analysis-section"><h3>O que conferir no campo</h3><ul>{(latestInsight.suggestedChecks || []).map((item, index) => <li key={`check-${index}`}>{item}</li>)}</ul></section>
          <section className="analysis-section"><h3>Limites desta análise</h3><ul>{[...(latestInsight.limitations || []), ...(insightAnalysis?.knownLimitations || [])].map((item, index) => <li key={`limit-${index}`}>{item}</li>)}</ul></section>
          <button className="analysis-done" type="button" onClick={() => setAnalysisOpen(false)}>Fechar análise</button>
        </>}
      </dialog>
    </main>
  );
}