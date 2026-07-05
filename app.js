const cleanupTabs = document.querySelectorAll(".filter-tabs button");
const navItems = document.querySelectorAll(".nav-item");
const pageViews = document.querySelectorAll(".page-view");
const pageTitle = document.querySelector("#pageTitle");
const scanButton = document.querySelector("#scanButton");
const scanProgress = document.querySelector(".scan-progress span");
const scanFoot = document.querySelector(".scan-foot");
const API_BASE = `${window.location.origin}/api`;

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  return payload.data;
}

const api = {
  scan: () => requestJson("/scan", { method: "POST", body: "{}" }),
  getConfig: () => requestJson("/config"),
  saveConfig: (config) =>
    requestJson("/config", { method: "PUT", body: JSON.stringify(config) }),
  getHistory: () => requestJson("/history"),
  getCleanupHistory: () => requestJson("/cleanup-history"),
  getStorageInfo: () => requestJson("/storage"),
  addPath: (kind, targetPath) =>
    requestJson(`/paths/${kind}`, { method: "POST", body: JSON.stringify({ path: targetPath }) }),
  deletePath: (targetPath) =>
    requestJson("/paths", { method: "DELETE", body: JSON.stringify({ path: targetPath }) }),
  chooseDirectory: () => window.prompt("请输入完整目录路径：", "D:\\"),
  showInFolder: (targetPath) =>
    requestJson("/reveal", { method: "POST", body: JSON.stringify({ path: targetPath }) }),
  exportReport: (result) =>
    requestJson("/report", { method: "POST", body: JSON.stringify({ result }) }),
  trashItems: (paths) =>
    requestJson("/trash", { method: "POST", body: JSON.stringify({ paths }) }),
  deleteItems: (paths) =>
    requestJson("/delete", { method: "POST", body: JSON.stringify({ paths }) }),
};

const fallbackConfig = {
  autoWatch: true,
  scanIntervalMinutes: 30,
  lowSpaceGb: 20,
  abnormalDropGb: 2,
  defaultRecycleBin: true,
  confirmBeforeDelete: true,
  protectSystemDirs: true,
  cleanupLogRetentionDays: 180,
  watchedPaths: [
    "C:\\Users\\51160\\Downloads",
    "C:\\Users\\51160\\Desktop",
    "C:\\Users\\51160\\AppData\\Local\\Temp",
    "C:\\Windows\\Temp",
    "C:\\Windows\\Minidump",
  ],
  protectedPaths: [
    "C:\\Windows\\System32",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
    "C:\\Users\\51160\\AppData\\Roaming",
  ],
};

let latestScan = null;
let currentConfig = null;
let lastCleanupHistory = [];
let lastHistory = [];
let fileTimeRangeDays = 7;
let chartRangeDays = 1;
let autoScanTimer = null;
let recentlyChangedPath = "";

function $(selector) {
  return document.querySelector(selector);
}

function setChecked(selector, value) {
  const element = $(selector);
  if (element) element.checked = value;
}

function setValue(selector, value) {
  const element = $(selector);
  if (element) element.value = value;
}

function getChecked(selector, fallback = false) {
  return $(selector)?.checked ?? fallback;
}

function getValue(selector, fallback = "") {
  return $(selector)?.value ?? fallback;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isToday(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatDateLabel(value, rangeDays) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  if (rangeDays <= 1) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function filterFilesByTime(files) {
  if (!fileTimeRangeDays) return files;
  const since = Date.now() - fileTimeRangeDays * 24 * 60 * 60 * 1000;
  return files.filter((file) => new Date(file.createdAt).getTime() >= since);
}

function recommendationText(value) {
  return {
    safe: "可直接删除",
    review: "确认后删除",
    protect: "不建议删除",
  }[value] || "确认后删除";
}

function badgeClass(source) {
  if (["临时", "缓存", "转储"].includes(source)) return "success";
  if (["日志", "安装包", "系统更新"].includes(source)) return "warning";
  return "neutral";
}

function applyCleanupFilter(filter) {
  document.querySelectorAll(".cleanup-card").forEach((card) => {
    card.classList.toggle("is-hidden", card.dataset.type !== filter);
  });
}

function groupBySource(files, type) {
  const groups = new Map();
  files
    .filter((file) => file.recommendation === type)
    .forEach((file) => {
      const key = file.source;
      const current = groups.get(key) || {
        source: key,
        size: 0,
        count: 0,
        paths: [],
      };
      current.size += file.size;
      current.count += 1;
      current.paths.push(file.path);
      groups.set(key, current);
    });
  return [...groups.values()].sort((a, b) => b.size - a.size);
}

function encodePaths(paths) {
  return encodeURIComponent(JSON.stringify(paths || []));
}

function decodePaths(value) {
  try {
    return JSON.parse(decodeURIComponent(value || "[]"));
  } catch {
    return [];
  }
}

function encodePath(value) {
  return encodeURIComponent(String(value || ""));
}

function decodePath(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}

function formatErrorMessage(value) {
  const message = String(value || "处理失败")
    .replace(/#< CLIXML[\s\S]*/g, "系统操作失败，可能是权限不足、文件被占用或路径已不存在")
    .replace(/[\uFFFD�]{2,}[\s\S]*/g, "系统操作失败，可能是权限不足、文件被占用或路径已不存在")
    .replace(/\s+/g, " ")
    .trim();
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

function normalizePathForCompare(value) {
  return String(value || "")
    .trim()
    .replaceAll("/", "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

function setScanningState(isScanning) {
  const label = scanButton.querySelector("span");
  scanButton.disabled = isScanning;
  label.textContent = isScanning ? "扫描中" : "立即扫描磁盘";
  scanProgress.style.width = isScanning ? "42%" : "100%";
}

function renderTrendChart(history, rangeDays = chartRangeDays) {
  const line = $("#chartLinePath");
  const fill = $("#chartFillPath");
  const pointsGroup = $("#chartPoints");
  const labels = $("#chartLabels");
  if (!line || !fill || !pointsGroup || !labels) return;

  const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  const points = (history || [])
    .filter((item) => new Date(item.scannedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(a.scannedAt) - new Date(b.scannedAt));
  const records = points.length > 0 ? points : latestScan ? [{ scannedAt: latestScan.scannedAt, disk: latestScan.disk }] : [];

  if (records.length === 0) {
    line.setAttribute("d", "");
    fill.setAttribute("d", "");
    pointsGroup.innerHTML = "";
    labels.innerHTML = "<span>暂无扫描记录</span><span></span><span></span><span></span><span>现在</span>";
    return;
  }

  const chart = { left: 32, right: 700, top: 44, bottom: 220 };
  const values = records.map((item) => item.disk.free || 0);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = Math.max(0, min - 1024 ** 3);
    max += 1024 ** 3;
  }

  const coordinates = records.map((item, index) => {
    const x =
      records.length === 1
        ? (chart.left + chart.right) / 2
        : chart.left + (index / (records.length - 1)) * (chart.right - chart.left);
    const ratio = ((item.disk.free || 0) - min) / (max - min);
    return {
      x,
      y: chart.bottom - ratio * (chart.bottom - chart.top),
      item,
    };
  });

  const linePath = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const fillPath = `${linePath} L${coordinates.at(-1).x.toFixed(1)} ${chart.bottom} L${coordinates[0].x.toFixed(1)} ${chart.bottom} Z`;

  line.setAttribute("d", linePath);
  fill.setAttribute("d", fillPath);
  pointsGroup.innerHTML = coordinates
    .map(
      (point) =>
        `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5"><title>${formatDateLabel(point.item.scannedAt, rangeDays)} ${formatBytes(point.item.disk.free)}</title></circle>`,
    )
    .join("");

  const first = records[0];
  const middle = records[Math.floor(records.length / 2)];
  const last = records.at(-1);
  labels.innerHTML =
    rangeDays <= 1
      ? "<span>24小时前</span><span>12小时前</span><span>6小时前</span><span>最近</span><span>现在</span>"
      : `<span>${formatDateLabel(first.scannedAt, rangeDays)}</span><span></span><span>${formatDateLabel(middle.scannedAt, rangeDays)}</span><span></span><span>${formatDateLabel(last.scannedAt, rangeDays)}</span>`;
}

function renderAlerts(result) {
  const alertList = $("#alertList");
  const alerts = [];
  const freeGb = result.disk.free / 1024 ** 3;

  if (freeGb < 20) {
    alerts.push({
      level: "high",
      icon: "triangle-alert",
      title: "C盘剩余空间偏低",
      text: `当前仅剩 ${formatBytes(result.disk.free)}，建议优先处理低风险清理项`,
    });
  }

  if (result.summary.todayAddedBytes > 2 * 1024 ** 3) {
    alerts.push({
      level: "medium",
      icon: "clock-3",
      title: "今日新增文件较多",
      text: `今天扫描到 ${formatBytes(result.summary.todayAddedBytes)} 新增或近期文件`,
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      level: "medium",
      icon: "shield-check",
      title: "暂无高风险提醒",
      text: `已扫描 ${result.scanStats.visitedFiles} 个文件，跳过 ${result.scanStats.skipped} 个无权限项`,
    });
  }

  alertList.innerHTML = alerts
    .map(
      (item) => `
        <div class="alert-item ${item.level}">
          <i data-lucide="${item.icon}"></i>
          <div>
            <strong>${item.title}</strong>
            <span>${escapeHtml(item.text)}</span>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderCleanupCards(result) {
  const cleanupList = $("#cleanupList");
  const cards = [
    ...groupBySource(result.files, "safe").map((item) => ({ ...item, type: "safe", icon: "shield-check" })),
    ...groupBySource(result.files, "review").map((item) => ({ ...item, type: "review", icon: "circle-help" })),
    ...groupBySource(result.files, "protect").map((item) => ({ ...item, type: "protect", icon: "lock-keyhole" })),
  ];

  cleanupList.innerHTML = cards
    .slice(0, 12)
    .map(
      (item) => `
        <article class="cleanup-card" data-type="${item.type}" data-paths="${encodePaths(item.paths)}">
          <div class="file-type ${item.type}"><i data-lucide="${item.icon}"></i></div>
          <div class="cleanup-content">
            <h3>${escapeHtml(item.source)}文件</h3>
            <p>${item.count} 个文件 · ${recommendationText(item.type)}</p>
          </div>
          <div class="cleanup-size">${formatBytes(item.size)}</div>
          <button class="icon-button quick-delete-button" type="button" aria-label="直接删除" title="${item.type === "protect" ? "已保护" : "直接删除"}" ${item.type === "protect" ? "disabled" : ""}>
            <i data-lucide="${item.type === "protect" ? "lock" : "trash-2"}"></i>
          </button>
        </article>
      `,
    )
    .join("");

  const activeTab = document.querySelector(".filter-tabs button.active");
  applyCleanupFilter(activeTab?.dataset.filter || "safe");
}

function renderFilesTables(files) {
  const filteredFiles = filterFilesByTime(files);
  const rows = filteredFiles
    .slice(0, 80)
    .map(
      (file) => `
        <tr data-path="${escapeHtml(file.path)}" data-search="${escapeHtml(`${file.name} ${file.directory} ${file.source}`.toLowerCase())}">
          <td title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</td>
          <td title="${escapeHtml(file.directory)}">${escapeHtml(file.directory)}</td>
          <td>${formatBytes(file.size)}</td>
          <td>${formatTime(file.createdAt)}</td>
          <td><span class="badge ${badgeClass(file.source)}">${escapeHtml(file.source)}</span></td>
          <td>${recommendationText(file.recommendation)}</td>
        </tr>
      `,
    )
    .join("");

  $("#filesTableBody").innerHTML = rows;
  $("#overviewFilesBody").innerHTML = files
    .slice(0, 6)
    .map(
      (file) => `
        <tr data-path="${escapeHtml(file.path)}">
          <td title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</td>
          <td>${formatBytes(file.size)}</td>
          <td>${formatTime(file.createdAt)}</td>
          <td><span class="badge ${badgeClass(file.source)}">${escapeHtml(file.source)}</span></td>
        </tr>
      `,
    )
    .join("");
}

function renderFileSummary(result) {
  const files = result.files || [];
  const todayFiles = files.filter((file) => isToday(file.createdAt));
  const todayBytes = todayFiles.reduce((sum, file) => sum + file.size, 0);
  const largeThreshold = 100 * 1024 ** 2;
  const largeFiles = files.filter((file) => file.size >= largeThreshold);
  const knownSources = files.filter((file) => !["未知", "程序文件"].includes(file.source));
  const explainPercent = files.length > 0 ? Math.round((knownSources.length / files.length) * 100) : 0;
  const previousScan = lastHistory.find((item) => item.scannedAt !== result.scannedAt);
  const previousRank = new Map((previousScan?.summary?.directoryRank || []).map((item) => [item.directory, item.size]));
  const growingDirs = (result.summary.directoryRank || []).filter((item) => {
    const previousSize = previousRank.get(item.directory);
    return Number.isFinite(previousSize) && item.size > previousSize;
  });
  const topSources = result.summary.sourceBreakdown
    .filter((item) => item.source !== "未知")
    .slice(0, 3)
    .map((item) => item.source)
    .join("、");

  $("#filesTodayCount").textContent = `${todayFiles.length} 个`;
  $("#filesTodaySize").textContent = `合计 ${formatBytes(todayBytes)}`;
  $("#filesLargeCount").textContent = `${largeFiles.length} 个`;
  $("#filesLargeHint").textContent = "单文件超过 100 MB";
  $("#filesGrowingCount").textContent = `${growingDirs.length} 个`;
  $("#filesGrowingHint").textContent = previousScan ? "对比上次扫描" : "暂无历史对比";
  $("#filesExplainPercent").textContent = `${explainPercent}%`;
  $("#filesExplainHint").textContent = topSources ? `${topSources}为主` : "暂无可识别来源";
}

function renderRank(result) {
  const max = Math.max(...result.summary.directoryRank.map((item) => item.size), 1);
  $("#rankList").innerHTML = result.summary.directoryRank
    .slice(0, 6)
    .map(
      (item) => `
        <div class="rank-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.directory)}</span>
          </div>
          <em>${formatBytes(item.size)}</em>
        </div>
        <div class="rank-bar"><span style="width: ${Math.max((item.size / max) * 100, 4)}%"></span></div>
      `,
    )
    .join("");
}

function renderSourceList(result) {
  const max = Math.max(...result.summary.sourceBreakdown.map((item) => item.size), 1);
  $("#sourceList").innerHTML = result.summary.sourceBreakdown
    .slice(0, 8)
    .map(
      (item) => `
        <div class="source-item">
          <span>${escapeHtml(item.source)}</span>
          <strong>${formatBytes(item.size)}</strong>
          <div class="rank-bar"><span style="width: ${Math.max((item.size / max) * 100, 4)}%"></span></div>
        </div>
      `,
    )
    .join("");
}

function renderCleanupRows(result) {
  const safeGroups = groupBySource(result.files, "safe");
  const reviewGroups = groupBySource(result.files, "review");

  function row(item, checked) {
    return `
      <label class="check-row">
        <input type="checkbox" ${checked ? "checked" : ""} data-size="${item.size}" data-paths="${encodePaths(item.paths)}" />
        <span>${escapeHtml(item.source)}文件 · ${item.count} 个</span>
        <strong>${formatBytes(item.size)}</strong>
      </label>
    `;
  }

  $("#safeCleanupRows").innerHTML = safeGroups.slice(0, 8).map((item) => row(item, true)).join("");
  $("#reviewCleanupRows").innerHTML = reviewGroups.slice(0, 8).map((item) => row(item, false)).join("");
  const protectedGroups = groupBySource(result.files, "protect");
  $("#protectedCleanupRows").innerHTML =
    protectedGroups.length > 0
      ? protectedGroups
          .slice(0, 6)
          .map(
            (item) => `
              <div class="protect-row">
                <span>${escapeHtml(item.source)}文件 · ${item.count} 个</span>
                <strong>已保护</strong>
              </div>
            `,
          )
          .join("")
      : (currentConfig?.protectedPaths || fallbackConfig.protectedPaths)
          .slice(0, 8)
          .map(
            (item) => `
              <div class="protect-row">
                <span>${escapeHtml(item)}</span>
                <strong>已保护</strong>
              </div>
            `,
          )
          .join("");

  updateCleanupSelection();
}

function updateCleanupSelection() {
  const selected = document.querySelectorAll('.check-row input[type="checkbox"]:checked');
  const total = [...selected].reduce((sum, item) => sum + Number(item.dataset.size || 0), 0);
  $("#confirmCount").textContent = `将清理 ${selected.length} 项`;
  $("#confirmSize").textContent = `预计释放 ${formatBytes(total)}`;
}

function renderHistory(history) {
  const items = history || [];
  lastHistory = items;
  const latest = items[0];
  $("#historyStats").innerHTML = `
    <div><span>历史扫描</span><strong>${items.length} 次</strong></div>
    <div><span>最近剩余</span><strong>${latest ? formatBytes(latest.disk.free) : "-"}</strong></div>
    <div><span>低风险空间</span><strong>${latest ? formatBytes(latest.summary.safeBytes) : "-"}</strong></div>
    <div><span>异常事件</span><strong>${latest ? latest.summary.alertCount : 0} 次</strong></div>
  `;

  $("#historyTimeline").innerHTML = items
    .slice(0, 8)
    .map(
      (item) => `
        <div class="timeline-item">
          <time>${formatTime(item.scannedAt)}</time>
          <div>
            <strong>完成一次空间扫描</strong>
            <span>剩余 ${formatBytes(item.disk.free)} · 可清理 ${formatBytes(item.summary.safeBytes)} · 新增 ${formatBytes(item.summary.todayAddedBytes)}</span>
          </div>
        </div>
      `,
    )
    .join("");
  renderTrendChart(items, chartRangeDays);
}

function renderCleanupHistory(history) {
  lastCleanupHistory = history || [];
  $("#cleanupHistoryBody").innerHTML = lastCleanupHistory
    .slice(0, 12)
    .map((item) => {
      const releasedBytes =
        item.successBytes ||
        (item.results || [])
          .filter((result) => result.ok)
          .reduce((sum, result) => sum + Number(result.size || 0), 0);
      return `
        <tr>
          <td>${formatTime(item.operatedAt)}</td>
          <td>${escapeHtml(item.action)}</td>
          <td>${formatBytes(releasedBytes)}</td>
          <td>${item.action === "直接删除" ? "不可恢复" : "回收站"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderStorageInfo(info) {
  if (!info || !$("#storageInfo")) return;
  const permissionText = info.isAdmin ? "管理员权限" : "普通权限";
  const permissionHint = info.isAdmin ? "可处理需要管理员权限的文件" : "部分系统文件会因权限不足无法删除";
  const runtimeStatus = $("#runtimeStatus");
  if (runtimeStatus) {
    runtimeStatus.textContent = info.isAdmin ? "管理员运行中" : "普通权限运行中";
  }
  $("#storageInfo").innerHTML = `
    <div><span>运行权限</span><strong>${permissionText}</strong></div>
    <div><span>权限说明</span><strong>${permissionHint}</strong></div>
    <div><span>存储类型</span><strong>${info.type === "sqlite" ? "SQLite 数据库" : "本地 JSON 文件"}</strong></div>
    <div><span>数据库</span><strong>${escapeHtml(info.database || "未接入")}</strong></div>
    <div><span>配置文件</span><strong>${escapeHtml(info.config)}</strong></div>
    <div><span>历史记录</span><strong>${escapeHtml(info.history)}</strong></div>
    <div><span>清理记录</span><strong>${escapeHtml(info.cleanupHistory)}</strong></div>
  `;
}

function renderConfig(config) {
  config.watchedPaths = Array.isArray(config.watchedPaths) ? config.watchedPaths : [];
  config.protectedPaths = Array.isArray(config.protectedPaths) ? config.protectedPaths : [];
  currentConfig = config;
  setChecked("#settingAutoWatch", config.autoWatch !== false);
  setValue(
    "#settingScanInterval",
    config.scanIntervalMinutes >= 1440
      ? "每天一次"
      : config.scanIntervalMinutes === 60
        ? "每 1 小时"
        : "每 30 分钟",
  );
  setValue("#settingLowSpace", config.lowSpaceGb);
  setValue("#settingAbnormalDrop", config.abnormalDropGb);
  setChecked("#settingDefaultRecycle", config.defaultRecycleBin !== false);
  setChecked("#settingConfirmDelete", config.confirmBeforeDelete !== false);
  setChecked("#settingProtectSystem", config.protectSystemDirs !== false);
  setValue(
    "#settingRetentionDays",
    config.cleanupLogRetentionDays === 90
      ? "90 天"
      : config.cleanupLogRetentionDays === 0
        ? "永久保留"
        : "180 天",
  );

  $("#watchedPathList").innerHTML =
    config.watchedPaths.length > 0
      ? config.watchedPaths
          .map(
            (item) => `
              <div class="${normalizePathForCompare(item) === normalizePathForCompare(recentlyChangedPath) ? "is-new" : ""}">
                <span>${escapeHtml(item)}</span>
                <button class="icon-button remove-path-button" type="button" aria-label="删除" data-kind="watched" data-path="${encodePath(item)}"><i data-lucide="x"></i></button>
              </div>
            `,
          )
          .join("")
      : '<div class="empty-row"><span>暂无重点监听目录</span></div>';
  $("#protectedPathList").innerHTML =
    config.protectedPaths.length > 0
      ? config.protectedPaths
          .map(
            (item) => `
              <div class="${normalizePathForCompare(item) === normalizePathForCompare(recentlyChangedPath) ? "is-new" : ""}">
                <span>${escapeHtml(item)}</span>
                <button class="icon-button remove-path-button" type="button" aria-label="删除" data-kind="protected" data-path="${encodePath(item)}"><i data-lucide="x"></i></button>
              </div>
            `,
          )
          .join("")
      : '<div class="empty-row"><span>暂无保护目录</span></div>';

  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }
}

function parseScanInterval(value) {
  if (value.includes("每天")) return 1440;
  if (value.includes("1 小时")) return 60;
  return 30;
}

function parseRetentionDays(value) {
  if (value.includes("永久")) return 0;
  if (value.includes("90")) return 90;
  return 180;
}

function scheduleAutoScan() {
  if (autoScanTimer) {
    window.clearInterval(autoScanTimer);
    autoScanTimer = null;
  }

  if (!api || !currentConfig || currentConfig.autoWatch === false) return;

  const intervalMs = Math.max(1, currentConfig.scanIntervalMinutes || 30) * 60 * 1000;
  autoScanTimer = window.setInterval(() => {
    runClientScan();
  }, intervalMs);
}

async function saveSettingsFromForm() {
  if (!currentConfig) return;
  const nextConfig = {
    ...currentConfig,
    autoWatch: getChecked("#settingAutoWatch", currentConfig.autoWatch !== false),
    scanIntervalMinutes: parseScanInterval(getValue("#settingScanInterval", "每 30 分钟")),
    lowSpaceGb: Number(getValue("#settingLowSpace", currentConfig.lowSpaceGb) || currentConfig.lowSpaceGb),
    abnormalDropGb: Number(getValue("#settingAbnormalDrop", currentConfig.abnormalDropGb) || currentConfig.abnormalDropGb),
    defaultRecycleBin: getChecked("#settingDefaultRecycle", currentConfig.defaultRecycleBin !== false),
    confirmBeforeDelete: getChecked("#settingConfirmDelete", currentConfig.confirmBeforeDelete !== false),
    protectSystemDirs: getChecked("#settingProtectSystem", currentConfig.protectSystemDirs !== false),
    cleanupLogRetentionDays: parseRetentionDays(getValue("#settingRetentionDays", "180 天")),
  };
  currentConfig = api ? await api.saveConfig(nextConfig) : nextConfig;
  if (!api) {
    window.localStorage.setItem("spacewatch-preview-config", JSON.stringify(currentConfig));
  }
  scheduleAutoScan();
  scanFoot.textContent = api ? "设置已保存" : "预览设置已保存";
}

async function saveAndRenderConfig(nextConfig) {
  currentConfig = api ? await api.saveConfig(nextConfig) : nextConfig;
  if (api) {
    currentConfig = await api.getConfig();
  }
  if (!api) {
    window.localStorage.setItem("spacewatch-preview-config", JSON.stringify(currentConfig));
  }
  renderConfig(currentConfig);
  scheduleAutoScan();
  scanFoot.textContent = api ? "设置已保存，下一次扫描生效" : "预览设置已保存";
}

async function refreshClientState() {
  if (!api) {
    renderConfig(currentConfig || fallbackConfig);
    if (latestScan) {
      renderScan(latestScan);
    }
    scanFoot.textContent = "已刷新预览页面数据";
    return;
  }

  const [config, history, cleanupHistory, storageInfo] = await Promise.all([
    api.getConfig(),
    api.getHistory(),
    api.getCleanupHistory(),
    api.getStorageInfo(),
  ]);
  renderConfig(config);
  renderHistory(history);
  renderCleanupHistory(cleanupHistory);
  renderStorageInfo(storageInfo);
  if (latestScan) {
    renderScan(latestScan);
  }
  scanFoot.textContent = "已刷新页面数据，未重新扫描磁盘";
}

async function chooseDirectoryPath(title) {
  return window.prompt(`${title}\n请输入完整目录路径：`, "D:\\");
}

async function addDirectoryToConfig(kind, title) {
  if (!currentConfig) return;
  const directory = (await chooseDirectoryPath(title))?.trim();
  if (!directory) {
    scanFoot.textContent = "未选择目录";
    return;
  }

  const key = kind === "protected" ? "protectedPaths" : "watchedPaths";
  const existing = currentConfig[key] || [];
  const normalized = normalizePathForCompare(directory);
  const alreadyExists = existing.some((item) => normalizePathForCompare(item) === normalized);

  recentlyChangedPath = directory;
  currentConfig = await api.addPath(kind, directory);
  renderConfig(currentConfig);
  await refreshClientState();
  if (latestScan) renderCleanupRows(latestScan);
  scanFoot.textContent = alreadyExists ? `目录已存在，已移动到顶部：${directory}` : `已添加目录：${directory}`;
}

function getFirstVisibleFilePath() {
  const activeFilesPage = document.querySelector('[data-page="files"].active');
  const filesRow = activeFilesPage
    ? [...document.querySelectorAll("#filesTableBody tr")].find((row) => row.style.display !== "none")
    : null;
  const overviewRow = [...document.querySelectorAll("#overviewFilesBody tr")].find(
    (row) => row.style.display !== "none",
  );
  return filesRow?.dataset.path || overviewRow?.dataset.path || latestScan?.files?.[0]?.path || null;
}

async function exportCurrentReport() {
  if (!api || !latestScan) {
    window.alert("请先完成一次扫描后再导出报告。");
    return;
  }

  const result = await api.exportReport(latestScan);
  if (result?.ok) {
    scanFoot.textContent = `报告已导出：${result.path}`;
  }
}

function previewCurrentReport() {
  if (!latestScan) {
    window.alert("请先完成一次扫描。");
    return;
  }

  window.alert(
    [
      "扫描报告预览",
      `扫描时间：${formatTime(latestScan.scannedAt)}`,
      `C盘剩余：${formatBytes(latestScan.disk.free)}`,
      `低风险可清理：${formatBytes(latestScan.summary.safeBytes)}`,
      `确认后删除：${formatBytes(latestScan.summary.reviewBytes)}`,
      `扫描文件数：${latestScan.scanStats.visitedFiles}`,
    ].join("\n"),
  );
}

function renderScan(result) {
  latestScan = result;
  $("#metricFree").textContent = formatBytes(result.disk.free);
  $("#metricTotal").textContent = `总容量 ${formatBytes(result.disk.total)}`;
  $("#metricToday").textContent = formatBytes(result.summary.todayAddedBytes);
  $("#metricTodayHint").textContent = `扫描 ${result.scanStats.visitedFiles} 个文件`;
  $("#metricSafe").textContent = formatBytes(result.summary.safeBytes);
  $("#metricAlerts").textContent = `${result.summary.alertCount} 条`;
  $("#metricAlertsHint").textContent = result.summary.alertCount ? "发现需要关注的空间变化" : "暂无异常提醒";
  scanFoot.textContent = `上次扫描 ${formatTime(result.scannedAt)}`;
  const listedSafeBytes = result.files
    .filter((file) => file.recommendation === "safe")
    .reduce((sum, file) => sum + file.size, 0);
  const listedReviewBytes = result.files
    .filter((file) => file.recommendation === "review")
    .reduce((sum, file) => sum + file.size, 0);
  $("#cleanupHeroTotal").textContent = formatBytes(listedSafeBytes + listedReviewBytes);
  $("#cleanupHeroSafe").textContent = `其中 ${formatBytes(listedSafeBytes)} 属于低风险清理项`;

  renderAlerts(result);
  renderCleanupCards(result);
  renderFileSummary(result);
  renderFilesTables(result.files);
  renderRank(result);
  renderSourceList(result);
  renderCleanupRows(result);
  renderTrendChart(lastHistory, chartRangeDays);

  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }
}

async function runClientScan() {
  if (!api) {
    runDemoScanAnimation();
    return;
  }

  try {
    setScanningState(true);
    const result = await api.scan();
    renderScan(result);
    renderHistory(await api.getHistory());
    renderCleanupHistory(await api.getCleanupHistory());
  } catch (error) {
    scanFoot.textContent = `扫描失败：${error.message}`;
  } finally {
    setScanningState(false);
  }
}

function getSelectedCleanupPaths() {
  const selectedPaths = [...document.querySelectorAll('.check-row input[type="checkbox"]:checked')]
    .flatMap((item) => decodePaths(item.dataset.paths))
    .filter(Boolean);
  return [...new Set(selectedPaths)];
}

async function performCleanup(paths, mode) {
  if (!api || !latestScan) return;
  if (paths.length === 0) {
    window.alert("请先选择要处理的清理项。");
    return;
  }

  const actionText = mode === "delete" ? "直接删除" : "移入回收站";
  const warning =
    mode === "delete"
      ? `确定要直接删除 ${paths.length} 个文件吗？此操作不会进入回收站，删除后不可恢复。`
      : `确定要把 ${paths.length} 个文件移入回收站吗？`;

  if (currentConfig?.confirmBeforeDelete !== false && !window.confirm(warning)) return;

  scanButton.disabled = true;
  scanFoot.textContent = `正在${actionText}`;

  const results =
    mode === "delete" ? await api.deleteItems(paths) : await api.trashItems(paths);
  const successCount = results.filter((item) => item.ok).length;
  const failCount = results.length - successCount;
  scanFoot.textContent = `${actionText}完成：成功 ${successCount} 项，失败 ${failCount} 项`;

  if (failCount > 0) {
    const failed = results.find((item) => !item.ok);
    window.alert(`有 ${failCount} 项未处理成功。\n${failed?.path || ""}\n${formatErrorMessage(failed?.error)}`);
  }

  await runClientScan();
}

function runDemoScanAnimation() {
  let progress = 12;
  const label = scanButton.querySelector("span");
  scanButton.disabled = true;
  label.textContent = "扫描中";
  scanProgress.style.width = `${progress}%`;

  const timer = window.setInterval(() => {
    progress += Math.floor(Math.random() * 18) + 8;
    scanProgress.style.width = `${Math.min(progress, 100)}%`;

    if (progress >= 100) {
      window.clearInterval(timer);
      label.textContent = "立即扫描磁盘";
      scanButton.disabled = false;
      scanFoot.textContent = "刚刚完成扫描";
    }
  }, 360);
}

cleanupTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    cleanupTabs.forEach((item) => item.classList.toggle("active", item === tab));
    applyCleanupFilter(tab.dataset.filter);
  });
});

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const view = item.dataset.view;
    navItems.forEach((nav) => nav.classList.toggle("active", nav === item));
    pageViews.forEach((page) => {
      page.classList.toggle("active", page.dataset.page === view);
    });
    pageTitle.textContent = item.dataset.title;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.closest(".segmented");
    group.querySelectorAll("button").forEach((item) => {
      item.classList.toggle("active", item === button);
    });

    if (button.closest('[data-page="files"]')) {
      const text = button.textContent.trim();
      fileTimeRangeDays = text === "今天" ? 1 : text === "30天" ? 30 : 7;
      if (latestScan) renderFilesTables(latestScan.files);
    }

    if (button.closest(".trend-panel")) {
      chartRangeDays = Number(button.dataset.chartRange || 1);
      renderTrendChart(lastHistory, chartRangeDays);
    }
  });
});

$(".search-box input")?.addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll("#filesTableBody tr").forEach((row) => {
    row.style.display = row.dataset.search.includes(query) ? "" : "none";
  });
});

document.addEventListener("change", (event) => {
  if (event.target.matches('.check-row input[type="checkbox"]')) {
    updateCleanupSelection();
  }

  if (event.target.closest('[data-page="settings"]')) {
    saveSettingsFromForm();
  }
});

$("#moveToRecycleButton")?.addEventListener("click", async () => {
  await performCleanup(getSelectedCleanupPaths(), "trash");
});

$("#deleteSelectedButton")?.addEventListener("click", async () => {
  await performCleanup(getSelectedCleanupPaths(), "delete");
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".quick-delete-button");
  if (!button || button.disabled) return;

  const card = button.closest(".cleanup-card");
  const paths = decodePaths(card?.dataset.paths).slice(0, 200);
  await performCleanup(paths, "delete");
});

document.addEventListener("click", async (event) => {
  const removeButton = event.target.closest(".remove-path-button");
  if (!removeButton || !currentConfig) return;
  event.preventDefault();
  event.stopPropagation();

  const targetPath = decodePath(removeButton.dataset.path);
  recentlyChangedPath = "";
  try {
    const result = await api.deletePath(targetPath);
    currentConfig = result.config;
    renderConfig(currentConfig);
    if (latestScan) renderCleanupRows(latestScan);
    scanFoot.textContent =
      result.removed > 0 ? `已移除目录：${targetPath}` : `未找到要移除的目录：${targetPath}`;
  } catch (error) {
    scanFoot.textContent = `移除失败：${error.message}`;
    window.alert(`移除失败：${error.message}`);
  }
});

$("#refreshButton")?.addEventListener("click", refreshClientState);
$("#exportReportButton")?.addEventListener("click", exportCurrentReport);
$("#previewReportButton")?.addEventListener("click", previewCurrentReport);

$("#overviewOpenLocationButton")?.addEventListener("click", async () => {
  const filePath = getFirstVisibleFilePath();
  if (!api || !filePath) {
    window.alert("当前没有可打开位置的文件。");
    return;
  }
  await api.showInFolder(filePath);
});

$("#fileFilterButton")?.addEventListener("click", () => {
  $(".search-box input")?.focus();
});

$("#filesColumnButton")?.addEventListener("click", () => {
  window.alert("当前版本已显示文件、路径、大小、生成时间、来源和建议。");
});

$("#addWatchedPathButton")?.addEventListener("click", async () => {
  await addDirectoryToConfig("watched", "添加重点监听目录");
});

$("#addProtectedPathButton")?.addEventListener("click", async () => {
  await addDirectoryToConfig("protected", "添加保护目录");
});

scanButton.addEventListener("click", runClientScan);

if (window.lucide) {
  window.lucide.createIcons({
    attrs: {
      "stroke-width": 2,
    },
  });
}

applyCleanupFilter("safe");

(async function boot() {
  const [config, history, cleanupHistory, storageInfo] = await Promise.all([
    api.getConfig(),
    api.getHistory(),
    api.getCleanupHistory(),
    api.getStorageInfo(),
  ]);
  renderConfig(config);
  renderHistory(history);
  renderCleanupHistory(cleanupHistory);
  renderStorageInfo(storageInfo);
  scheduleAutoScan();
  await runClientScan();
})();
