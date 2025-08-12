import { fs, path } from '@purinton/common';
import { getLocalMachineInfo } from './machineInfo.mjs';

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

export function loadPromptConfig() {
    try {
        const raw = fs.readFileSync(path(import.meta, '../../openai.json'), 'utf8');
        const cfg = JSON.parse(raw);
        const machineInfo = getLocalMachineInfo();
        if (Array.isArray(cfg.messages)) {
            cfg.messages.forEach(msg => {
                if (Array.isArray(msg.content)) {
                    msg.content.forEach(part => {
                        if (part && typeof part.text === 'string' && part.text.includes('{localMachineInfo}')) {
                            part.text = part.text.replaceAll('{localMachineInfo}', machineInfo);
                        }
                    });
                }
            });
        }
        return validatePromptConfig(cfg);
    } catch (err) {
        throw new Error(`Failed to load/validate openai.json: ${err.message}`);
    }
}
