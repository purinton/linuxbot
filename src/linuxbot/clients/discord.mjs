import { createDiscord } from '@purinton/discord';
import { log, path } from '@purinton/common';

export async function createDiscordClient({ presence, version, openai, allowIds, promptConfig }) {
    return createDiscord({
        log,
        rootDir: path(import.meta, '../../../'),
        context: { presence, version, openai, allowIds, promptConfig },
        intents: {
            Guilds: true,
            GuildMessages: true,
            MessageContent: true,
        }
    });
}
