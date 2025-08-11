#!/usr/bin/env node
import 'dotenv/config';
import { createOpenAI } from '@purinton/openai';
import { createDiscord } from '@purinton/discord';
import { log, fs, path, registerHandlers, registerSignals } from '@purinton/common';

registerHandlers({ log });
registerSignals({ log });

const packageJson = JSON.parse(fs.readFileSync(path(import.meta, 'package.json')), 'utf8');
const version = packageJson.version;

const presence = { activities: [{ name: `linuxbot v${version}`, type: 4 }], status: 'online' };

const { OPENAI_API_KEY, ALLOW_IDS } = process.env;
if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in the environment variables.');
}

if (!ALLOW_IDS) {
    throw new Error('ALLOW_IDS is not set in the environment variables.');
}

function validatePromptConfig(cfg) {
    if (typeof cfg !== 'object' || cfg === null) {
        throw new Error('openai.json: root must be an object');
    }
    if (!cfg.model || typeof cfg.model !== 'string') {
        throw new Error('openai.json: "model" must be a non-empty string');
    }
    if (!Array.isArray(cfg.messages) || cfg.messages.length === 0) {
        throw new Error('openai.json: "messages" must be a non-empty array');
    }
    cfg.messages.forEach((msg, i) => {
        if (typeof msg !== 'object' || msg === null) {
            throw new Error(`openai.json: messages[${i}] must be an object`);
        }
        if (!msg.role || typeof msg.role !== 'string') {
            throw new Error(`openai.json: messages[${i}].role must be a non-empty string`);
        }
        if (!Array.isArray(msg.content) || msg.content.length === 0) {
            throw new Error(`openai.json: messages[${i}].content must be a non-empty array`);
        }
        msg.content.forEach((c, j) => {
            if (typeof c !== 'object' || c === null) {
                throw new Error(`openai.json: messages[${i}].content[${j}] must be an object`);
            }
            if (!c.type || typeof c.type !== 'string') {
                throw new Error(`openai.json: messages[${i}].content[${j}].type must be a non-empty string`);
            }
            if (c.type === 'input_text' && (typeof c.text !== 'string' || c.text.trim().length === 0)) {
                throw new Error(`openai.json: messages[${i}].content[${j}].text must be a non-empty string for type input_text`);
            }
        });
    });
    return Object.freeze(cfg);
}

let promptConfig;
try {
    const raw = fs.readFileSync(path(import.meta, 'openai.json'), 'utf8');
    promptConfig = validatePromptConfig(JSON.parse(raw));
} catch (err) {
    throw new Error(`Failed to load/validate openai.json: ${err.message}`);
}

const allowIds = ALLOW_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0);
if (allowIds.length === 0) {
    throw new Error('ALLOW_IDS must contain at least one ID.');
}
allowIds.forEach(id => {
    if (!/^\d{17,19}$/.test(id)) {
        throw new Error(`Invalid ID in ALLOW_IDS: ${id}`);
    }
});

const openai = await createOpenAI();

const client = await createDiscord({
    log,
    rootDir: path(import.meta),
    context: {
        presence,
        version,
        openai,
        allowIds,
    promptConfig
    },
    intents: {
        Guilds: true,
        GuildMessages: true,
        MessageContent: true,
    }
});
registerSignals({ shutdownHook: () => client.destroy() });
