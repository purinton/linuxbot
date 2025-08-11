// events/ready.mjs
import os from 'os';

export default async function ({ log, presence }, client) {
    log.info(`Logged in as ${client.user.tag}`);
    if (presence) client.user.setPresence(presence);

    // Periodically update presence with system load averages (1,5,15 min)
    const status = presence?.status || 'online';
    function formatLoad() {
        return os.loadavg().slice(0, 3).map(n => n.toFixed(2)).join(', ');
    }
    
    function updatePresence() {
        try {
            client.user.setPresence({
                status,
                activities: [{ name: formatLoad(), type: 4 }]
            });
        } catch (err) {
            log.warn(`Failed to update presence load averages: ${err.message}`);
        }
    }

    // Initial update and 10s interval
    updatePresence();
    const loadInterval = setInterval(updatePresence, 10_000);

    // Clean up on shutdown
    const clear = () => clearInterval(loadInterval);
    client.once('shardDisconnect', clear);
    process.once('beforeExit', clear);
}
