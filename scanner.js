const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 24 * 60 * 60 * 1000;

function buildDefaultConfig() {
  const home = os.homedir();
  return {
    drive: "C:\\",
    autoWatch: true,
    scanIntervalMinutes: 30,
    lowSpaceGb: 20,
    abnormalDropGb: 2,
    defaultRecycleBin: true,
    confirmBeforeDelete: true,
    protectSystemDirs: true,
    cleanupLogRetentionDays: 180,
    maxFilesPerScan: 9000,
    minLargeFileMb: 100,
    watchedPaths: [
      path.join(home, "Downloads"),
      path.join(home, "Desktop"),
      path.join(home, "AppData", "Local", "Temp"),
      path.join(home, "AppData", "Local", "Google", "Chrome", "User Data", "Default", "Cache"),
      path.join("C:\\", "Windows", "Temp"),
      path.join("C:\\", "Windows", "Minidump"),
      path.join("C:\\", "Windows", "SoftwareDistribution", "Download"),
    ],
    protectedPaths: [
      path.join("C:\\", "Windows", "System32"),
      path.join("C:\\", "Program Files"),
      path.join("C:\\", "Program Files (x86)"),
      path.join("C:\\", "ProgramData"),
      path.join(home, "AppData", "Roaming"),
    ],
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getDiskInfo(drive) {
  try {
    const stats = await fs.statfs(drive);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    return {
      drive,
      total,
      free,
      used: total - free,
      freePercent: total > 0 ? free / total : 0,
    };
  } catch {
    return {
      drive,
      total: 0,
      free: 0,
      used: 0,
      freePercent: 0,
    };
  }
}

function normalizePath(value) {
  return path.resolve(value).toLowerCase();
}

function isProtected(filePath, protectedPaths) {
  const normalized = normalizePath(filePath);
  return protectedPaths.some((protectedPath) =>
    normalized.startsWith(normalizePath(protectedPath)),
  );
}

function getSource(filePath) {
  const lowered = filePath.toLowerCase();
  const ext = path.extname(filePath).toLowerCase();

  if (lowered.includes("\\temp\\") || lowered.includes("\\tmp\\")) return "临时";
  if (lowered.includes("softwaredistribution\\download")) return "系统更新";
  if (lowered.includes("\\minidump") || ext === ".dmp") return "转储";
  if (lowered.includes("\\cache") || lowered.includes("\\code cache")) return "缓存";
  if (lowered.includes("\\downloads")) return "下载";
  if ([".log", ".etl", ".trace"].includes(ext)) return "日志";
  if (lowered.includes("\\programdata\\") && [".exe", ".dll", ".ico", ".dat"].includes(ext)) return "程序文件";
  if ([".zip", ".rar", ".7z", ".iso", ".msi", ".exe"].includes(ext)) return "安装包";
  if ([".mp4", ".mov", ".mkv", ".avi"].includes(ext)) return "视频";
  return "未知";
}

function getRecommendation(filePath, source, protectedPaths) {
  if (isProtected(filePath, protectedPaths)) {
    return "protect";
  }

  if (["临时", "缓存", "转储"].includes(source)) {
    return "safe";
  }

  if (source === "程序文件") {
    return "protect";
  }

  if (["下载", "日志", "安装包", "视频", "系统更新"].includes(source)) {
    return "review";
  }

  return "review";
}

function formatFileRecord(filePath, stats, root, protectedPaths) {
  const source = getSource(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    directory: path.dirname(filePath),
    root,
    size: stats.size,
    createdAt: stats.birthtime.toISOString(),
    modifiedAt: stats.mtime.toISOString(),
    accessedAt: stats.atime.toISOString(),
    source,
    recommendation: getRecommendation(filePath, source, protectedPaths),
  };
}

async function walkDirectory(root, config, state) {
  if (state.visitedFiles >= config.maxFilesPerScan) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (state.visitedFiles >= config.maxFilesPerScan) {
      return;
    }

    const filePath = path.join(root, entry.name);

    try {
      if (entry.isDirectory()) {
        if (!isProtected(filePath, config.protectedPaths)) {
          await walkDirectory(filePath, config, state);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      state.visitedFiles += 1;
      const stats = await fs.stat(filePath);
      state.totalBytes += stats.size;
      state.rootSizes.set(
        state.currentRoot,
        (state.rootSizes.get(state.currentRoot) || 0) + stats.size,
      );

      const isLarge = stats.size >= config.minLargeFileMb * MB;
      const isRecent = Date.now() - stats.birthtime.getTime() <= 7 * DAY;
      if (isLarge || isRecent) {
        state.files.push(formatFileRecord(filePath, stats, state.currentRoot, config.protectedPaths));
      }
    } catch {
      state.skipped += 1;
    }
  }
}

function summarize(files, disk, config, rootSizes) {
  const byRecommendation = { safe: 0, review: 0, protect: 0 };
  const bySource = new Map();
  const today = Date.now() - DAY;
  let todayAdded = 0;
  let largeFiles = 0;

  for (const file of files) {
    byRecommendation[file.recommendation] += file.size;
    bySource.set(file.source, (bySource.get(file.source) || 0) + file.size);
    if (new Date(file.createdAt).getTime() >= today) {
      todayAdded += file.size;
    }
    if (file.size >= config.minLargeFileMb * MB) {
      largeFiles += 1;
    }
  }

  const sourceBreakdown = [...bySource.entries()]
    .map(([source, size]) => ({ source, size }))
    .sort((a, b) => b.size - a.size);

  const directoryRank = [...rootSizes.entries()]
    .map(([directory, size]) => ({ directory, name: path.basename(directory) || directory, size }))
    .sort((a, b) => b.size - a.size);

  return {
    safeBytes: byRecommendation.safe,
    reviewBytes: byRecommendation.review,
    protectedBytes: byRecommendation.protect,
    todayAddedBytes: todayAdded,
    largeFiles,
    sourceBreakdown,
    directoryRank,
    alertCount:
      (disk.free > 0 && disk.free < config.lowSpaceGb * GB ? 1 : 0) +
      (todayAdded > config.abnormalDropGb * GB ? 1 : 0),
  };
}

async function runScan(inputConfig) {
  const config = {
    ...buildDefaultConfig(),
    ...inputConfig,
  };
  config.watchedPaths = [...new Set(config.watchedPaths || [])];
  config.protectedPaths = [...new Set(config.protectedPaths || [])];

  const disk = await getDiskInfo(config.drive);
  const state = {
    files: [],
    rootSizes: new Map(),
    currentRoot: "",
    totalBytes: 0,
    visitedFiles: 0,
    skipped: 0,
  };

  for (const root of config.watchedPaths) {
    if (!(await pathExists(root))) {
      continue;
    }
    state.currentRoot = root;
    state.rootSizes.set(root, 0);
    await walkDirectory(root, config, state);
  }

  state.files.sort((a, b) => b.size - a.size);

  return {
    scannedAt: new Date().toISOString(),
    disk,
    files: state.files.slice(0, 500),
    summary: summarize(state.files, disk, config, state.rootSizes),
    scanStats: {
      visitedFiles: state.visitedFiles,
      skipped: state.skipped,
      watchedPathCount: config.watchedPaths.length,
    },
  };
}

module.exports = {
  buildDefaultConfig,
  runScan,
  readJsonFile,
  writeJsonFile,
};
