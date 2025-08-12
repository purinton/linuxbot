export function loadEnv() {
    const { OPENAI_API_KEY, ALLOW_IDS } = process.env;
    if (!OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set in the environment variables.');
    }
    if (!ALLOW_IDS) {
        throw new Error('ALLOW_IDS is not set in the environment variables.');
    }
    const allowIds = ALLOW_IDS.split(',').map(id => id.trim()).filter(Boolean);
    if (allowIds.length === 0) {
        throw new Error('ALLOW_IDS must contain at least one ID.');
    }
    allowIds.forEach(id => {
        if (!/^\d{17,19}$/.test(id)) {
            throw new Error(`Invalid ID in ALLOW_IDS: ${id}`);
        }
    });
    return { OPENAI_API_KEY, ALLOW_IDS, allowIds };
}
