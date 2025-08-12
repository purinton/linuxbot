import { log, registerHandlers, registerSignals } from '@purinton/common';
import { getVersion } from './version.mjs';
import { loadEnv } from './env.mjs';
import { loadPromptConfig } from './promptConfig.mjs';
import { createPresence } from './presence.mjs';
import { createOpenAIClient } from './clients/openai.mjs';
import { createDiscordClient } from './clients/discord.mjs';

registerHandlers({ log });

export async function start() {
    const version = getVersion();
    const { allowIds } = loadEnv();
    const promptConfig = loadPromptConfig();
    const presence = createPresence(version);
    const openai = await createOpenAIClient();
    const client = await createDiscordClient({ presence, version, openai, allowIds, promptConfig });
    registerSignals({ log, shutdownHook: () => client.destroy() });
    return client;
}
