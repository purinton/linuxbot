export function createPresence(version) {
    return { activities: [{ name: `linuxbot v${version}`, type: 4 }], status: 'online' };
}
