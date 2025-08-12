import os from 'os';
import fs from 'fs';

function readOsRelease() {
    try {
        const data = fs.readFileSync('/etc/os-release', 'utf8');
        const map = {};
        data.split('\n').forEach(line => {
            const idx = line.indexOf('=');
            if (idx > 0) {
                const key = line.slice(0, idx);
                let val = line.slice(idx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                map[key] = val;
            }
        });
        return map;
    } catch {
        return null;
    }
}

function detectContainer() {
    try {
        if (fs.existsSync('/.dockerenv')) return 'docker';
        const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
        if (/docker|kubepods|containerd|podman/i.test(cgroup)) return 'container';
    } catch {/* ignore */}
    return null;
}

let cachedInfo;
export function getLocalMachineInfo() {
    if (cachedInfo) return cachedInfo;
    const hostname = os.hostname();
    const platform = os.platform();
    const release = os.release();
    const arch = os.arch();
    const totalMemGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
    const cpus = os.cpus() || [];
    const cpuModels = [...new Set(cpus.map(c => c.model.trim()))];
    const cpuSummary = cpuModels.join(' | ');
    const cpuCount = cpus.length;
    const nodeVersion = process.version;
    const osr = readOsRelease();
    const prettyName = osr?.PRETTY_NAME || osr?.NAME;
    const container = detectContainer();
    let user;
    try { user = os.userInfo().username; } catch { user = process.env.USER || process.env.USERNAME; }
    const homeDir = os.homedir();

    const lines = [
        `Hostname: ${hostname}`,
        prettyName ? `OS: ${prettyName} (platform=${platform} release=${release})` : `OS: platform=${platform} release=${release}`,
        `Arch: ${arch}`,
        `CPU: ${cpuSummary} (cores=${cpuCount})`,
        `Memory: ${totalMemGB} GB total`,
        `Node: ${nodeVersion}`,
        user ? `User: ${user}` : null,
        homeDir ? `Home: ${homeDir}` : null,
    ];
    if (container) lines.push(`Environment: ${container}`);
    // Remove any null entries
    const filtered = lines.filter(Boolean);
    cachedInfo = filtered.join('\n');
    return cachedInfo;
}
