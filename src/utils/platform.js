const os = require('os');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

function isElevated() {
  if (isWindows) {
    try {
      const result = spawnSync('net.exe', ['session'], { stdio: 'ignore', windowsHide: true });
      return result.status === 0;
    } catch (e) {
      return false;
    }
  } else {
    return process.getuid && process.getuid() === 0;
  }
}

function getPlatformInfo() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const uptime = os.uptime();
  const elevated = isElevated();

  return {
    os: process.platform,
    release: os.release(),
    architecture: os.arch(),
    hostname: os.hostname(),
    username: os.userInfo().username,
    homeDirectory: os.homedir(),
    isElevated: elevated,
    elevationLabel: elevated
      ? isWindows
        ? 'ELEVADO (Permisos de Administrador)'
        : 'ELEVADO (Root)'
      : 'USUARIO ESTÁNDAR',
    cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown',
    cpuCores: cpus.length,
    totalMemoryGB: (totalMem / (1024 ** 3)).toFixed(2) + ' GB',
    freeMemoryGB: (freeMem / (1024 ** 3)).toFixed(2) + ' GB',
    usedMemoryGB: ((totalMem - freeMem) / (1024 ** 3)).toFixed(2) + ' GB',
    memoryUsagePercent: (((totalMem - freeMem) / totalMem) * 100).toFixed(1) + '%',
    uptimeHours: (uptime / 3600).toFixed(2) + ' horas',
  };
}

module.exports = {
  isWindows,
  isMac,
  isLinux,
  isElevated,
  getPlatformInfo,
};
