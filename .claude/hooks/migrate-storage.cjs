#!/usr/bin/env node

const { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs');
const { join, dirname } = require('node:path');

const STORAGE_VERSION = 'asset-runs-v2';

function findAssetBotRoot(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, '.asset-bot', 'project.json');
    if (existsSync(candidate)) {
      return join(dir, '.asset-bot');
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function isEmptyDir(dirPath) {
  if (!existsSync(dirPath)) return true;
  return readdirSync(dirPath).length === 0;
}

function removeLegacySubdirs(assetPath) {
  const legacySubdirs = ['canonical', 'candidates', '.archive', 'refs'];
  for (const name of legacySubdirs) {
    rmSync(join(assetPath, name), { recursive: true, force: true });
  }
}

function flattenCanonicalDir(assetPath) {
  const canonicalPath = join(assetPath, 'canonical');
  if (!existsSync(canonicalPath)) return;

  for (const entry of readdirSync(canonicalPath, { withFileTypes: true })) {
    const src = join(canonicalPath, entry.name);
    const dest = join(assetPath, entry.name);
    if (existsSync(dest)) {
      throw new Error(`Cannot migrate "${src}" because "${dest}" already exists.`);
    }
    renameSync(src, dest);
  }
}

function ensureRecordCategory(recordPath, category) {
  const raw = JSON.parse(readFileSync(recordPath, 'utf8'));
  if (typeof raw.category === 'string' && raw.category.length > 0) {
    return;
  }
  raw.category = category;
  writeFileSync(recordPath, `${JSON.stringify(raw, null, 2)}\n`);
}

function discoverLegacyAssetDirs(assetsRoot) {
  if (!existsSync(assetsRoot)) return [];

  const legacy = [];
  for (const categoryEntry of readdirSync(assetsRoot, { withFileTypes: true })) {
    if (!categoryEntry.isDirectory()) continue;
    const category = categoryEntry.name;
    const categoryPath = join(assetsRoot, category);

    for (const assetEntry of readdirSync(categoryPath, { withFileTypes: true })) {
      if (!assetEntry.isDirectory()) continue;
      const assetPath = join(categoryPath, assetEntry.name);
      const recordPath = join(assetPath, 'record.json');
      if (!existsSync(recordPath)) continue;
      legacy.push({
        category,
        assetId: assetEntry.name,
        sourcePath: assetPath,
        recordPath,
      });
    }
  }

  return legacy;
}

function discoverFlatAssets(assetsRoot) {
  if (!existsSync(assetsRoot)) return [];

  const assetPaths = [];
  for (const entry of readdirSync(assetsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const assetPath = join(assetsRoot, entry.name);
    const recordPath = join(assetPath, 'record.json');
    if (!existsSync(recordPath)) continue;
    assetPaths.push(assetPath);
  }
  return assetPaths;
}

function migrateAssetLayout(assetBotRoot) {
  const assetsRoot = join(assetBotRoot, 'assets');
  if (!existsSync(assetsRoot)) {
    return;
  }
  const legacyAssets = discoverLegacyAssetDirs(assetsRoot);

  for (const legacy of legacyAssets) {
    const targetPath = join(assetsRoot, legacy.assetId);
    if (existsSync(targetPath)) {
      throw new Error(`Cannot migrate "${legacy.sourcePath}" because "${targetPath}" already exists.`);
    }

    renameSync(legacy.sourcePath, targetPath);
    ensureRecordCategory(join(targetPath, 'record.json'), legacy.category);
  }

  for (const assetPath of discoverFlatAssets(assetsRoot)) {
    flattenCanonicalDir(assetPath);
    removeLegacySubdirs(assetPath);
  }

  for (const entry of readdirSync(assetsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = join(assetsRoot, entry.name);
    if (existsSync(join(dirPath, 'record.json'))) continue;
    if (isEmptyDir(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }
}

function migrateIfNeeded() {
  const assetBotRoot = findAssetBotRoot(process.cwd());
  if (!assetBotRoot) {
    return;
  }

  const projectPath = join(assetBotRoot, 'project.json');
  const project = JSON.parse(readFileSync(projectPath, 'utf8'));

  if (project.storageVersion === STORAGE_VERSION) {
    return;
  }

  migrateAssetLayout(assetBotRoot);

  project.storageVersion = STORAGE_VERSION;
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
}

try {
  migrateIfNeeded();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate-storage] ${message}`);
  process.exitCode = 1;
}
