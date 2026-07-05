const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  buildDefaultConfig,
  runScan,
  readJsonFile,
  writeJsonFile,
} = require("./scanner");

const PORT = Number(process.env.SPACEWATCH_PORT || 17890);
const DATA_ROOT = path.join(__dirname, "data");
const USER_DATA = path.join(DATA_ROOT, "user-data");
const DB_PATH = path.join(DATA_ROOT, "spacewatch.sqlite");
const LEGACY_CONFIG = path.join(USER_DATA, "config.json");
const LEGACY_HISTORY = path.join(USER_DATA, "history.json");
const LEGACY_CLEANUP_HISTORY = path.join(USER_DATA, "cleanup-history.json");

let db;
let server;

function normalizePath(value) {
  return path.resolve(value).toLowerCase();
}

function normalizePathForCompare(value) {
  return String(value || "")
    .trim()
    .replaceAll("/", "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

function isProtectedPath(filePath, protectedPaths) {
  const normalized = normalizePath(filePath);
  return protectedPaths.some((protectedPath) =>
    normalized.startsWith(normalizePath(protectedPath)),
  );
}

function getDefaultSettings(config = buildDefaultConfig()) {
  return {
    drive: config.drive,
    autoWatch: config.autoWatch,
    scanIntervalMinutes: config.scanIntervalMinutes,
    lowSpaceGb: config.lowSpaceGb,
    abnormalDropGb: config.abnormalDropGb,
    maxFilesPerScan: config.maxFilesPerScan,
    minLargeFileMb: config.minLargeFileMb,
    defaultRecycleBin: config.defaultRecycleBin,
    confirmBeforeDelete: config.confirmBeforeDelete,
    protectSystemDirs: config.protectSystemDirs,
    cleanupLogRetentionDays: config.cleanupLogRetentionDays,
  };
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('watched', 'protected')),
      path TEXT NOT NULL,
      normalized_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(kind, normalized_path)
    );
    CREATE TABLE IF NOT EXISTS scan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scanned_at TEXT NOT NULL,
      disk_json TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cleanup_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operated_at TEXT NOT NULL,
      action TEXT NOT NULL,
      requested_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      success_bytes INTEGER NOT NULL DEFAULT 0,
      results_json TEXT NOT NULL
    );
  `);
}

function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

function insertPath(kind, targetPath) {
  const cleanPath = String(targetPath || "").trim();
  if (!cleanPath) return null;
  db.prepare(`
    INSERT INTO paths (kind, path, normalized_path)
    VALUES (?, ?, ?)
    ON CONFLICT(kind, normalized_path) DO UPDATE SET path = excluded.path
  `).run(kind, cleanPath, normalizePathForCompare(cleanPath));
  return getPathRows(kind).find((item) => item.normalizedPath === normalizePathForCompare(cleanPath));
}

function deletePathEverywhere(targetPath) {
  const normalized = normalizePathForCompare(targetPath);
  const result = db.prepare("DELETE FROM paths WHERE normalized_path = ?").run(normalized);
  return result.changes || 0;
}

function getPathRows(kind) {
  return db
    .prepare("SELECT id, kind, path, normalized_path AS normalizedPath FROM paths WHERE kind = ? ORDER BY id DESC")
    .all(kind);
}

function getConfig() {
  const settings = getSetting("settings", getDefaultSettings());
  return {
    ...buildDefaultConfig(),
    ...settings,
    watchedPaths: getPathRows("watched").map((item) => item.path),
    protectedPaths: getPathRows("protected").map((item) => item.path),
  };
}

function saveConfig(config) {
  const settings = getDefaultSettings({ ...buildDefaultConfig(), ...config });
  setSetting("settings", settings);
  if (Array.isArray(config.watchedPaths)) {
    db.prepare("DELETE FROM paths WHERE kind = 'watched'").run();
    for (const item of config.watchedPaths) insertPath("watched", item);
  }
  if (Array.isArray(config.protectedPaths)) {
    db.prepare("DELETE FROM paths WHERE kind = 'protected'").run();
    for (const item of config.protectedPaths) insertPath("protected", item);
  }
  return getConfig();
}

async function migrateLegacyData() {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM paths").get();
  if (existing.count > 0) return;

  const legacyConfig = await readJsonFile(LEGACY_CONFIG, null);
  const defaultConfig = { ...buildDefaultConfig(), ...(legacyConfig || {}) };
  saveConfig(defaultConfig);

  const legacyHistory = await readJsonFile(LEGACY_HISTORY, []);
  const insertHistory = db.prepare(`
    INSERT INTO scan_history (scanned_at, disk_json, summary_json)
    VALUES (?, ?, ?)
  `);
  for (const item of legacyHistory.slice(0, 200).reverse()) {
    insertHistory.run(
      item.scannedAt || new Date().toISOString(),
      JSON.stringify(item.disk || {}),
      JSON.stringify(item.summary || {}),
    );
  }

  const legacyCleanupHistory = await readJsonFile(LEGACY_CLEANUP_HISTORY, []);
  const insertCleanup = db.prepare(`
    INSERT INTO cleanup_history (operated_at, action, requested_count, success_count, success_bytes, results_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const item of legacyCleanupHistory.slice(0, 200).reverse()) {
    insertCleanup.run(
      item.operatedAt || new Date().toISOString(),
      item.action || "未知操作",
      item.requestedCount || 0,
      item.successCount || 0,
      item.successBytes || 0,
      JSON.stringify(item.results || []),
    );
  }
}

function getHistory() {
  return db
    .prepare("SELECT scanned_at AS scannedAt, disk_json AS diskJson, summary_json AS summaryJson FROM scan_history ORDER BY id DESC LIMIT 200")
    .all()
    .map((item) => ({
      scannedAt: item.scannedAt,
      disk: JSON.parse(item.diskJson),
      summary: JSON.parse(item.summaryJson),
    }));
}

function appendHistory(result) {
  db.prepare(`
    INSERT INTO scan_history (scanned_at, disk_json, summary_json)
    VALUES (?, ?, ?)
  `).run(result.scannedAt, JSON.stringify(result.disk), JSON.stringify(result.summary));
}

function getCleanupHistory() {
  return db
    .prepare(`
      SELECT operated_at AS operatedAt, action, requested_count AS requestedCount,
             success_count AS successCount, success_bytes AS successBytes, results_json AS resultsJson
      FROM cleanup_history
      ORDER BY id DESC
      LIMIT 200
    `)
    .all()
    .map((item) => ({
      operatedAt: item.operatedAt,
      action: item.action,
      requestedCount: item.requestedCount,
      successCount: item.successCount,
      successBytes: item.successBytes,
      results: JSON.parse(item.resultsJson),
    }));
}

function appendCleanupHistory(entry) {
  db.prepare(`
    INSERT INTO cleanup_history (operated_at, action, requested_count, success_count, success_bytes, results_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entry.operatedAt,
    entry.action,
    entry.requestedCount || 0,
    entry.successCount || 0,
    entry.successBytes || 0,
    JSON.stringify(entry.results || []),
  );
}

async function getExistingFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch {
    return 0;
  }
}

function runCommand(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(normalizeCommandError(stderr || stdout || error.message)));
        return;
      }
      resolve(stdout);
    });
  });
}

function decodePowerShellText(value) {
  return String(value || "")
    .replace(/_x([0-9a-fA-F]{4})_/g, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCommandError(value) {
  const raw = decodePowerShellText(value);
  if (!raw) return "系统命令执行失败";
  if (raw.includes("PATH_NOT_FOUND")) return "路径不存在，可能已被删除或移动";
  if (raw.includes("ACCESS_DENIED")) return "权限不足，无法处理该文件";
  if (raw.includes("FILE_IN_USE")) return "文件正在被程序占用，无法处理";
  if (raw.includes("DeleteFile") || raw.includes("DeleteDirectory")) {
    return "系统回收站操作失败，可能是权限不足、文件被占用或路径已不存在";
  }
  if (raw.includes("RECYCLE_FAILED:")) {
    const detail = raw.slice(raw.indexOf("RECYCLE_FAILED:") + "RECYCLE_FAILED:".length).trim();
    if (/[\uFFFD�]{2,}|[\u0080-\u00ff]{4,}/.test(detail)) {
      return "系统回收站操作失败，可能是权限不足、文件被占用或路径已不存在";
    }
    return detail || "移入回收站失败";
  }
  if (raw.startsWith("#< CLIXML") || raw.includes("System.Management.Automation")) {
    return "系统回收站操作失败，可能是权限不足、文件被占用或路径已不存在";
  }
  if (/[\uFFFD�]{2,}|[\u0080-\u00ff]{4,}/.test(raw)) {
    return "系统操作失败，可能是权限不足、文件被占用或路径已不存在";
  }
  return raw.slice(0, 300);
}

function normalizeFileError(error) {
  if (!error) return "文件处理失败";
  if (["ENOENT"].includes(error.code)) return "路径不存在，可能已被删除或移动";
  if (["EACCES", "EPERM"].includes(error.code)) return "权限不足或文件正在被占用，无法处理";
  if (["EBUSY"].includes(error.code)) return "文件正在被程序占用，无法处理";
  return normalizeCommandError(error.message || String(error));
}

async function movePathToRecycleBin(filePath) {
  if (!path.isAbsolute(filePath)) throw new Error("不是有效的绝对路径");
  try {
    await fs.access(filePath);
  } catch {
    throw new Error("路径不存在，可能已被删除或移动");
  }
  const encodedPath = Buffer.from(filePath, "utf8").toString("base64");
  const script = `
    $ProgressPreference = 'SilentlyContinue'
    $ErrorActionPreference = 'Stop'
    $TargetPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedPath}"))
    try {
      Add-Type -AssemblyName Microsoft.VisualBasic
      if (Test-Path -LiteralPath $TargetPath -PathType Container) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
          $TargetPath,
          [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
          [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
        )
        exit 0
      }
      if (Test-Path -LiteralPath $TargetPath -PathType Leaf) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
          $TargetPath,
          [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
          [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
        )
        exit 0
      }
      [Console]::Error.Write("PATH_NOT_FOUND")
      exit 2
    }
    catch {
      $message = $_.Exception.Message
      if ($message -match "denied|拒绝|权限") {
        [Console]::Error.Write("ACCESS_DENIED")
      } elseif ($message -match "used by another process|正在使用|占用") {
        [Console]::Error.Write("FILE_IN_USE")
      } else {
        [Console]::Error.Write("RECYCLE_FAILED:" + $message)
      }
      exit 1
    }
  `;
  await runCommand("powershell.exe", [
    "-STA",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]);
}

async function revealInExplorer(filePath) {
  if (!path.isAbsolute(filePath)) throw new Error("不是有效的绝对路径");
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await runCommand("explorer.exe", [filePath]);
      return;
    }
  } catch {
    // Missing files can still be selected by Explorer when the parent exists.
  }
  const safePath = filePath.replaceAll('"', "");
  await runCommand("explorer.exe", [`/select,"${safePath}"`]);
}

async function isRunningAsAdmin() {
  if (process.platform !== "win32") return false;
  try {
    await runCommand("fltmc.exe", []);
    return true;
  } catch {
    return false;
  }
}

function jsonOk(res, data) {
  res.json({ ok: true, data });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function createApp(options = {}) {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  await fs.mkdir(USER_DATA, { recursive: true });

  db = new DatabaseSync(DB_PATH);
  initSchema();
  await migrateLegacyData();

  const expressApp = express();
  expressApp.use(express.json({ limit: "20mb" }));
  expressApp.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
    }
    next();
  });
  expressApp.use(express.static(__dirname));

  expressApp.get("/api/config", (_req, res) => jsonOk(res, getConfig()));
  expressApp.put("/api/config", (req, res) => jsonOk(res, saveConfig(req.body || {})));
  expressApp.get("/api/paths", (_req, res) =>
    jsonOk(res, {
      watchedPaths: getPathRows("watched"),
      protectedPaths: getPathRows("protected"),
    }),
  );
  expressApp.post("/api/paths/:kind", (req, res) => {
    const kind = req.params.kind === "protected" ? "protected" : "watched";
    insertPath(kind, req.body?.path);
    jsonOk(res, getConfig());
  });
  expressApp.delete("/api/paths", (req, res) => {
    const removed = deletePathEverywhere(req.body?.path);
    jsonOk(res, { removed, config: getConfig() });
  });
  expressApp.get("/api/history", (_req, res) => jsonOk(res, getHistory()));
  expressApp.get("/api/cleanup-history", (_req, res) => jsonOk(res, getCleanupHistory()));
  expressApp.get("/api/storage", asyncHandler(async (_req, res) =>
    jsonOk(res, {
      type: "sqlite",
      database: DB_PATH,
      userData: USER_DATA,
      config: DB_PATH,
      history: DB_PATH,
      cleanupHistory: DB_PATH,
      isAdmin: await isRunningAsAdmin(),
    }),
  ));
  expressApp.post("/api/scan", asyncHandler(async (_req, res) => {
    const result = await runScan(getConfig());
    appendHistory(result);
    jsonOk(res, result);
  }));
  expressApp.post("/api/report", asyncHandler(async (req, res) => {
    const result = req.body?.result;
    const targetPath = path.join(DATA_ROOT, `SpaceWatch-扫描报告-${new Date().toISOString().slice(0, 10)}.json`);
    await writeJsonFile(targetPath, {
      exportedAt: new Date().toISOString(),
      ...result,
      cleanupHistory: getCleanupHistory(),
    });
    jsonOk(res, { path: targetPath });
  }));
  expressApp.post("/api/trash", asyncHandler(async (req, res) => {
    const config = getConfig();
    const paths = req.body?.paths || [];
    const results = [];
    let successCount = 0;
    let successBytes = 0;
    for (const filePath of paths) {
      try {
        if (config.protectSystemDirs !== false && isProtectedPath(filePath, config.protectedPaths || [])) {
          throw new Error("该路径属于保护目录，已阻止移入回收站");
        }
        const size = await getExistingFileSize(filePath);
        await movePathToRecycleBin(filePath);
        successCount += 1;
        successBytes += size;
        results.push({ path: filePath, ok: true, size });
      } catch (error) {
        results.push({ path: filePath, ok: false, error: normalizeFileError(error) });
      }
    }
    appendCleanupHistory({
      operatedAt: new Date().toISOString(),
      action: "移入回收站",
      requestedCount: paths.length,
      successCount,
      successBytes,
      results,
    });
    jsonOk(res, results);
  }));
  expressApp.post("/api/delete", asyncHandler(async (req, res) => {
    const config = getConfig();
    const paths = req.body?.paths || [];
    const results = [];
    let successCount = 0;
    let successBytes = 0;
    for (const filePath of paths) {
      try {
        if (!path.isAbsolute(filePath)) throw new Error("不是有效的绝对路径");
        if (config.protectSystemDirs !== false && isProtectedPath(filePath, config.protectedPaths || [])) {
          throw new Error("该路径属于保护目录，已阻止直接删除");
        }
        const size = await getExistingFileSize(filePath);
        await fs.unlink(filePath);
        successCount += 1;
        successBytes += size;
        results.push({ path: filePath, ok: true, size });
      } catch (error) {
        results.push({ path: filePath, ok: false, error: normalizeFileError(error) });
      }
    }
    appendCleanupHistory({
      operatedAt: new Date().toISOString(),
      action: "直接删除",
      requestedCount: paths.length,
      successCount,
      successBytes,
      results,
    });
    jsonOk(res, results);
  }));
  expressApp.post("/api/reveal", asyncHandler(async (req, res) => {
    await revealInExplorer(req.body?.path || "");
    jsonOk(res, { opened: true });
  }));

  expressApp.use((error, _req, res, _next) => {
    res.status(500).json({ ok: false, error: error.message });
  });

  return expressApp;
}

async function startServer(options = {}) {
  const expressApp = await createApp(options);
  const port = options.port || PORT;
  await new Promise((resolve, reject) => {
    server = expressApp.listen(port, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return { app: expressApp, server, port, dbPath: DB_PATH };
}

async function stopServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  if (db) {
    db.close();
    db = null;
  }
}

if (require.main === module) {
  startServer().then(({ port }) => {
    console.log(`SpaceWatch server listening on http://127.0.0.1:${port}`);
  });
}

module.exports = {
  startServer,
  stopServer,
  getConfig,
  saveConfig,
  getHistory,
  getCleanupHistory,
  DB_PATH,
};
