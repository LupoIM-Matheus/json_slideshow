const STORAGE_KEY = "tvPowerBiReports:v1";
const SOURCE_URL_KEY = "tvPowerBiReportsUrl:v1";
const DEFAULT_DISPLAY_SECONDS = 30;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_REPORTS = 200;
const MAX_NAME_LENGTH = 80;
const MIN_DISPLAY_SECONDS = 5;
const MAX_DISPLAY_SECONDS = 3600;
const POWER_BI_HOST = "app.powerbi.com";
const POWER_BI_PATH = "/reportEmbed";
const GITHUB_RAW_HOST = "raw.githubusercontent.com";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const frame = document.getElementById("reportFrame");
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

let config = null;
let currentIndex = 0;
let remaining = DEFAULT_DISPLAY_SECONDS;
let timerId = null;

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
    url = new URL(rawUrl);
  } catch {
    fail("URL invalida");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== POWER_BI_HOST ||
    url.pathname !== POWER_BI_PATH ||
    url.username ||
    url.password ||
    url.hash
  ) {
    fail("URL fora do Power BI permitido");
  }

  const reportId = url.searchParams.get("reportId");
  const tenantId = url.searchParams.get("ctid");

  if (!reportId || !UUID_PATTERN.test(reportId)) {
    fail("reportId invalido");
  }

  if (!tenantId || !UUID_PATTERN.test(tenantId)) {
    fail("ctid invalido");
  }

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

function validateConfig(value) {
  assertPlainObject(value, "JSON raiz invalido");
  assertAllowedKeys(value, ["displaySeconds", "reports"], "Campo raiz nao permitido");

  if (!Array.isArray(value.reports) || value.reports.length === 0) {
    fail("Lista de relatorios vazia");
  }

  if (value.reports.length > MAX_REPORTS) {
    fail("Muitos relatorios");
  }

  return {
    displaySeconds: sanitizeDisplaySeconds(value.displaySeconds),
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
}

function clearFrame() {
  frame.removeAttribute("src");
  reportName.textContent = "";
  timer.textContent = "";
}

function setNoConfig(message) {
  configPanel.classList.remove("hidden");
  stopRotation();
  config = null;
  currentIndex = 0;
  remaining = DEFAULT_DISPLAY_SECONDS;
  clearFrame();
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

function showReport(index) {
  if (!config) {
    return;
  }

  const report = config.reports[index % config.reports.length];
  currentIndex = index % config.reports.length;
  remaining = config.displaySeconds;
  frame.src = report.url;
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
  showReport(0);
  timerId = window.setInterval(tick, 1000);
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
    startRotation(parseConfigText(storedConfig), "Configuracao local carregada.", true);
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