const STORAGE_KEY = "tvPowerBiReports:v1";
const SOURCE_URL_KEY = "tvPowerBiReportsUrl:v1";
const DEFAULT_DISPLAY_SECONDS = 30;
const DEFAULT_REFRESH_MINUTES = 60;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_REPORTS = 200;
const MAX_NAME_LENGTH = 80;
const MIN_DISPLAY_SECONDS = 5;
const MAX_DISPLAY_SECONDS = 3600;
const MIN_REFRESH_MINUTES = 5;
const MAX_REFRESH_MINUTES = 1440;
const POWER_BI_HOST = "app.powerbi.com";
const POWER_BI_EMBED_PATH = "/reportEmbed";
const POWER_BI_SERVICE_FULLSCREEN_PARAM = ["chromeless", "1"];
const POWER_BI_EMBED_FULLSCREEN_PARAMS = [
  ["filterPaneEnabled", "false"],
  ["navContentPaneEnabled", "false"],
];
const POWER_BI_PUBLISH_PATH = "/view";
const GITHUB_RAW_HOST = "raw.githubusercontent.com";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const frameDeck = document.getElementById("frameDeck");
const reportName = document.getElementById("reportName");
const timer = document.getElementById("timer");
const overlay = document.getElementById("startOverlay");
const startButton = document.getElementById("startButton");
const configUrl = document.getElementById("configUrl");
const loadUrlButton = document.getElementById("loadUrlButton");
const refreshConfigButton = document.getElementById("refreshConfigButton");
const configFile = document.getElementById("configFile");
const loadConfigButton = document.getElementById("loadConfigButton");
const clearConfigButton = document.getElementById("clearConfigButton");
const configStatus = document.getElementById("configStatus");
const configPanel = document.getElementById("configPanel");
const loadedCount = document.getElementById("loadedCount");
const rotationSeconds = document.getElementById("rotationSeconds");

let config = null;
let currentIndex = 0;
let remaining = DEFAULT_DISPLAY_SECONDS;
let timerId = null;
let refreshTimerId = null;
let reportFrames = [];

function fail(message) {
  throw new Error(message);
}

function assertPlainObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(message);
  }
}

function assertAllowedKeys(value, allowedKeys, message) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      fail(`${message}: ${key}`);
    }
  }
}

function sanitizeName(name) {
  if (typeof name !== "string") {
    fail("Nome invalido");
  }

  const cleanName = name.trim();
  if (!cleanName || cleanName.length > MAX_NAME_LENGTH) {
    fail("Nome fora do limite");
  }

  if (/[<>]/.test(cleanName)) {
    fail("Nome contem HTML");
  }

  return cleanName;
}

function sanitizeConfigUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    fail("URL do JSON invalida");
  }

  if (/[<>]/.test(rawUrl)) {
    fail("URL do JSON contem HTML");
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    fail("URL do JSON invalida");
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== GITHUB_RAW_HOST ||
    url.username ||
    url.password ||
    url.hash ||
    pathParts.length < 4 ||
    !url.pathname.toLowerCase().endsWith(".json")
  ) {
    fail("Use uma URL raw do GitHub para um arquivo .json");
  }

  return url.toString();
}

function sanitizeReportUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    fail("URL invalida");
  }

  if (/[<>]/.test(rawUrl)) {
    fail("URL contem HTML");
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    fail("URL invalida");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== POWER_BI_HOST ||
    url.username ||
    url.password ||
    url.hash
  ) {
    fail("URL fora do Power BI permitido");
  }

  const tenantId = url.searchParams.get("ctid");
  if (tenantId && !UUID_PATTERN.test(tenantId)) {
    fail("ctid invalido");
  }

  if (isPowerBiEmbedUrl(url)) {
    return normalizePowerBiEmbedUrl(url);
  }

  if (isPowerBiServiceReportUrl(url)) {
    return normalizePowerBiServiceReportUrl(url);
  }

  if (isPowerBiPublishUrl(url)) {
    return normalizePowerBiServiceReportUrl(url);
  }

  fail("Formato de URL Power BI nao permitido");
}

function isPowerBiEmbedUrl(url) {
  const reportId = url.searchParams.get("reportId");

  if (url.pathname !== POWER_BI_EMBED_PATH) {
    return false;
  }

  if (!reportId || !UUID_PATTERN.test(reportId)) {
    fail("reportId invalido");
  }

  return true;
}

function isPowerBiServiceReportUrl(url) {
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (
    pathParts[0] === "groups" &&
    (pathParts[1] === "me" || UUID_PATTERN.test(pathParts[1])) &&
    (pathParts[2] === "reports" || pathParts[2] === "rdlreports") &&
    UUID_PATTERN.test(pathParts[3])
  ) {
    return true;
  }

  if (
    (pathParts[0] === "reports" || pathParts[0] === "rdlreports") &&
    UUID_PATTERN.test(pathParts[1])
  ) {
    return true;
  }

  return false;
}

function isPowerBiPublishUrl(url) {
  return url.pathname === POWER_BI_PUBLISH_PATH && Boolean(url.searchParams.get("r"));
}

function normalizePowerBiEmbedUrl(url) {
  for (const [key, value] of POWER_BI_EMBED_FULLSCREEN_PARAMS) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function normalizePowerBiServiceReportUrl(url) {
  url.searchParams.set(...POWER_BI_SERVICE_FULLSCREEN_PARAM);
  return url.toString();
}

function sanitizeDisplaySeconds(value) {
  if (value === undefined) {
    return DEFAULT_DISPLAY_SECONDS;
  }

  if (
    !Number.isInteger(value) ||
    value < MIN_DISPLAY_SECONDS ||
    value > MAX_DISPLAY_SECONDS
  ) {
    fail("displaySeconds invalido");
  }

  return value;
}

function sanitizeRefreshMinutes(value) {
  if (value === undefined) {
    return DEFAULT_REFRESH_MINUTES;
  }

  if (
    !Number.isInteger(value) ||
    value < MIN_REFRESH_MINUTES ||
    value > MAX_REFRESH_MINUTES
  ) {
    fail("refreshMinutes invalido");
  }

  return value;
}

function validateConfig(value) {
  assertPlainObject(value, "JSON raiz invalido");
  assertAllowedKeys(
    value,
    ["displaySeconds", "refreshMinutes", "reports"],
    "Campo raiz nao permitido"
  );

  if (!Array.isArray(value.reports) || value.reports.length === 0) {
    fail("Lista de relatorios vazia");
  }

  if (value.reports.length > MAX_REPORTS) {
    fail("Muitos relatorios");
  }

  return {
    displaySeconds: sanitizeDisplaySeconds(value.displaySeconds),
    refreshMinutes: sanitizeRefreshMinutes(value.refreshMinutes),
    reports: value.reports.map((report) => {
      assertPlainObject(report, "Relatorio invalido");
      assertAllowedKeys(report, ["name", "url"], "Campo de relatorio nao permitido");

      return {
        name: sanitizeName(report.name),
        url: sanitizeReportUrl(report.url),
      };
    }),
  };
}

function parseConfigText(text) {
  if (text.length > MAX_FILE_BYTES) {
    fail("JSON acima de 256 KB");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("JSON invalido");
  }

  return validateConfig(parsed);
}

function setStatus(message) {
  configStatus.textContent = message;
}

function stopRotation() {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }

  if (refreshTimerId) {
    window.clearInterval(refreshTimerId);
    refreshTimerId = null;
  }
}

function clearFrames() {
  frameDeck.replaceChildren();
  reportFrames = [];
  reportName.textContent = "";
  timer.textContent = "";
  loadedCount.textContent = "0";
  rotationSeconds.textContent = `${DEFAULT_DISPLAY_SECONDS}s`;
}

function setNoConfig(message) {
  configPanel.classList.remove("hidden");
  stopRotation();
  config = null;
  currentIndex = 0;
  remaining = DEFAULT_DISPLAY_SECONDS;
  clearFrames();
  startButton.disabled = true;
  overlay.classList.remove("hidden");
  setStatus(message);
}

function saveConfig(nextConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
}

function saveSourceUrl(url) {
  localStorage.setItem(SOURCE_URL_KEY, url);
}

function createReportFrame(report, index, loadImmediately = true) {
  const reportFrame = document.createElement("iframe");
  reportFrame.className = "report-frame";
  reportFrame.title = report.name;
  reportFrame.referrerPolicy = "no-referrer";
  reportFrame.sandbox =
    "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads";
  reportFrame.allowFullscreen = true;
  reportFrame.dataset.index = String(index);
  if (loadImmediately) {
    reportFrame.src = report.url;
  }
  return reportFrame;
}

function preloadReports(nextConfig) {
  frameDeck.replaceChildren();
  reportFrames = nextConfig.reports.map(createReportFrame);
  frameDeck.append(...reportFrames);
  loadedCount.textContent = String(nextConfig.reports.length);
  rotationSeconds.textContent = `${nextConfig.displaySeconds}s`;
}

function refreshReportFrame(index) {
  if (!config || !reportFrames[index]) {
    return;
  }

  const oldFrame = reportFrames[index];
  const nextFrame = createReportFrame(config.reports[index], index, false);

  nextFrame.addEventListener(
    "load",
    () => {
      if (reportFrames[index] !== oldFrame) {
        nextFrame.remove();
        return;
      }

      const isActive = currentIndex === index;
      nextFrame.classList.toggle("active", isActive);
      reportFrames[index] = nextFrame;
      oldFrame.remove();
    },
    { once: true }
  );

  oldFrame.insertAdjacentElement("afterend", nextFrame);
  nextFrame.src = config.reports[index].url;
}

function refreshReports() {
  if (!config) {
    return;
  }

  config.reports.forEach((_, index) => refreshReportFrame(index));
}

function startScheduledRefresh() {
  if (!config) {
    return;
  }

  refreshTimerId = window.setInterval(
    refreshReports,
    config.refreshMinutes * 60 * 1000
  );
}

function showReport(index) {
  if (!config) {
    return;
  }

  const report = config.reports[index % config.reports.length];
  currentIndex = index % config.reports.length;
  remaining = config.displaySeconds;
  reportFrames.forEach((reportFrame, frameIndex) => {
    reportFrame.classList.toggle("active", frameIndex === currentIndex);
  });
  reportName.textContent = report.name;
  timer.textContent = `${remaining}s`;
}

function nextReport() {
  showReport(currentIndex + 1);
}

function tick() {
  if (!config) {
    return;
  }

  remaining -= 1;
  if (remaining <= 0) {
    nextReport();
    return;
  }

  timer.textContent = `${remaining}s`;
}

function startRotation(nextConfig, message, hideConfigPanel = false) {
  if (hideConfigPanel) {
    configPanel.classList.add("hidden");
  } else {
    configPanel.classList.remove("hidden");
  }
  stopRotation();
  config = nextConfig;
  currentIndex = 0;
  remaining = config.displaySeconds;
  startButton.disabled = false;
  preloadReports(config);
  showReport(0);
  timerId = window.setInterval(tick, 1000);
  startScheduledRefresh();
  setStatus(message);
}

function openConfigPanel(message) {
  configPanel.classList.remove("hidden");
  overlay.classList.remove("hidden");
  const savedUrl = localStorage.getItem(SOURCE_URL_KEY);
  configUrl.value = savedUrl || configUrl.value;
  setStatus(message);
}

function loadStoredConfig() {
  const savedUrl = localStorage.getItem(SOURCE_URL_KEY);
  if (savedUrl) {
    configUrl.value = savedUrl;
  }

  const storedConfig = localStorage.getItem(STORAGE_KEY);
  if (!storedConfig) {
    setNoConfig("Informe a URL raw do GitHub ou carregue um JSON.");
    return;
  }

  try {
    startRotation(parseConfigText(storedConfig), "Configuracao local carregada.");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    setNoConfig("Configuracao salva era invalida e foi removida.");
  }
}

async function fetchConfigFromUrl(rawUrl) {
  const url = sanitizeConfigUrl(rawUrl);
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });

  if (!response.ok) {
    fail("Nao foi possivel baixar o JSON");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength && contentLength > MAX_FILE_BYTES) {
    fail("JSON acima de 256 KB");
  }

  const text = await response.text();
  const nextConfig = parseConfigText(text);
  return { nextConfig, url };
}

async function loadUrlConfig() {
  try {
    setStatus("Baixando JSON...");
    const { nextConfig, url } = await fetchConfigFromUrl(configUrl.value);
    saveConfig(nextConfig);
    saveSourceUrl(url);
    startRotation(nextConfig, "JSON do GitHub carregado e salvo localmente.");
  } catch (error) {
    setStatus(error.message || "JSON rejeitado");
  }
}

function readSelectedFile() {
  const file = configFile.files[0];
  if (!file) {
    fail("Selecione um arquivo JSON");
  }

  if (file.size > MAX_FILE_BYTES) {
    fail("Arquivo acima de 256 KB");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Falha ao ler arquivo")));
    reader.readAsText(file, "utf-8");
  });
}

async function loadUploadedConfig() {
  try {
    const text = await readSelectedFile();
    const nextConfig = parseConfigText(text);
    saveConfig(nextConfig);
    startRotation(nextConfig, "JSON carregado e salvo localmente.");
    configFile.value = "";
  } catch (error) {
    setStatus(error.message || "JSON rejeitado");
  }
}

function clearStoredConfig() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SOURCE_URL_KEY);
  configUrl.value = "";
  configFile.value = "";
  setNoConfig("Configuracao removida. Informe uma URL raw do GitHub.");
}

async function enterFullscreen() {
  const target = document.documentElement;
  if (target.requestFullscreen && !document.fullscreenElement) {
    await target.requestFullscreen();
  }
}

loadUrlButton.addEventListener("click", loadUrlConfig);
loadConfigButton.addEventListener("click", loadUploadedConfig);
clearConfigButton.addEventListener("click", clearStoredConfig);
refreshConfigButton.addEventListener("click", () => {
  openConfigPanel("Confirme a URL do JSON para atualizar.");
});

startButton.addEventListener("click", async () => {
  if (!config) {
    setStatus("Carregue um JSON valido antes de iniciar.");
    return;
  }

  try {
    await enterFullscreen();
  } catch {
    // Fullscreen can be blocked by browser policy.
  }
  overlay.classList.add("hidden");
});

loadStoredConfig();
