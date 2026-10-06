import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const distDir = path.resolve('dist');
const zipFile = path.join(distDir, 'attendance-tracker-launcher.zip');
const extDir = path.resolve('companion-extension');

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

if (existsSync(zipFile)) {
  unlinkSync(zipFile);
}

try {
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${extDir}\\*' -DestinationPath '${zipFile}' -Force"`, {
      stdio: 'inherit'
    });
  } else {
    execSync(`cd "${extDir}" && zip -r "${zipFile}" ./*`, { stdio: 'inherit' });
  }
  console.log(`[package-extension] Successfully created: ${zipFile}`);
} catch (err) {
  console.error('[package-extension] Failed to package extension:', err);
  process.exit(1);
}
