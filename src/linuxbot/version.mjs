import { fs, path } from '@purinton/common';

export function getVersion() {
    const packageJson = JSON.parse(fs.readFileSync(path(import.meta, '../../package.json'), 'utf8'));
    if (!packageJson.version || typeof packageJson.version !== 'string') {
        throw new Error('package.json: missing or invalid version');
    }
    return packageJson.version;
}
