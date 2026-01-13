#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// タウリの設定ファイルからバージョンを読み取る
const tauriConfigPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf-8'));
const version = tauriConfig.version;

console.log(`Updating version to: ${version}`);

// Service Workerのバージョンを更新
const swPath = path.join(__dirname, '..', 'public', 'sw.js');
let swContent = fs.readFileSync(swPath, 'utf-8');
swContent = swContent.replace(
  /const APP_VERSION = ['"][\d.]+['"]/,
  `const APP_VERSION = '${version}'`
);
fs.writeFileSync(swPath, swContent);
console.log('✓ Updated Service Worker version');

// updateChecker.tsのバージョンを更新
const updateCheckerPath = path.join(__dirname, '..', 'src', 'utils', 'updateChecker.ts');
if (fs.existsSync(updateCheckerPath)) {
  let updateCheckerContent = fs.readFileSync(updateCheckerPath, 'utf-8');
  updateCheckerContent = updateCheckerContent.replace(
    /export const CURRENT_VERSION = ['"][\d.]+['"]/,
    `export const CURRENT_VERSION = '${version}'`
  );
  fs.writeFileSync(updateCheckerPath, updateCheckerContent);
  console.log('✓ Updated updateChecker.ts version');
}

// package.jsonのバージョンも同期
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
packageJson.version = version;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
console.log('✓ Updated package.json version');

console.log(`\nVersion update complete: ${version}`);