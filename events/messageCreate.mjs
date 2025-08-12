// events/messageCreate.mjs
import { splitMsg } from '@purinton/discord';
import fs from 'fs';
import path from 'path';
export default async function ({ client, log, msg, openai, promptConfig, allowIds }, message) {
    log.debug('messageCreate', { id: message.id });
    if (message.author.id === client.user.id) return;
    try {
        const userId = message.author?.id;
        const userAllowed = userId && allowIds.includes(userId);

        // Collect role IDs if guild message and member cached
        let roleAllowed = false;
        try {
            const roleIds = message.member?.roles?.cache ? Array.from(message.member.roles.cache.keys()) : [];
            roleAllowed = roleIds.some(rid => allowIds.includes(rid));
        } catch (err) {
            log.debug('roleCheckFailed', { error: err.message });
        }

        if (!userAllowed && !roleAllowed) {
            log.debug('unauthorizedMessageIgnored', { userId });
            return; // Not permitted
        }

        // Invocation requirement: must mention bot, mention a role the bot has, or be a reply to bot
        let invoked = false;
        const botId = client.user.id;

        // 1. Direct mention of bot (@bot)
        if (message.mentions?.users?.has(botId)) invoked = true;

        // 2. Mention of a role the bot possesses
        if (!invoked && message.guild && message.mentions?.roles?.size) {
            try {
                const botMember = message.guild.members?.me; // cached member for bot
                if (botMember?.roles?.cache?.size) {
                    const botRoleIds = new Set(botMember.roles.cache.keys());
                    invoked = Array.from(message.mentions.roles.keys()).some(rid => botRoleIds.has(rid));
                }
            } catch (err) {
                log.debug('botRoleCheckFailed', { error: err.message });
            }
        }

        // 3. Reply chain: message is a reply to a bot message
        if (!invoked && message.reference?.messageId) {
            try {
                const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                if (refMsg?.author?.id === botId) invoked = true;
            } catch (err) {
                log.debug('replyFetchFailed', { error: err.message });
            }
        }

        if (!invoked) {
            log.debug('invocationMissingIgnored', { userId, messageId: message.id });
            return; // Not addressed to bot context
        }
        // Fetch last 100 messages in the channel (includes current message)
        let fetched;
        try {
            fetched = await message.channel.messages.fetch({ limit: 100 });
        } catch (err) {
            log.warn('historyFetchFailed', { error: err.message, channelId: message.channel.id });
            await message.channel.send('History fetch failed.');
            return;
        }

        // Sort chronologically oldest -> newest
        const history = Array.from(fetched.values())
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        // Clone promptConfig and inject history as messages
        const clonedPrompt = {
            ...promptConfig,
            messages: [
                ...promptConfig.messages.map(m => ({
                    role: m.role,
                    content: m.content.map(c => ({ ...c }))
                })),
                ...history.map(m => {
                    const role = m.author?.id === client.user.id ? 'assistant' : 'user';
                    let text = (m.cleanContent || m.content || '').trim();
                    if (!text) return null;
                    if (role === 'user') {
                        text = `${m.author.username}: ${text}`;
                    }
                    return {
                        role,
                        content: [
                            { type: 'text', text }
                        ]
                    };
                }).filter(Boolean)
            ]
        };

        // Debug log the full prompt
        log.debug('openaiPrompt', { prompt: clonedPrompt });

        // Start typing notification and repeat every 5 seconds
        let typingInterval;
        try {
            await message.channel.sendTyping();
            typingInterval = setInterval(() => {
                message.channel.sendTyping().catch(() => {});
            }, 5000);
        } catch (err) {
            log.debug('typingNotificationFailed', { error: err.message });
        }

        // Helper: execute tool calls in parallel and return results map
        async function executeToolCalls(toolCalls) {
            const root = process.cwd();
            const jobs = toolCalls.map(async tc => {
                const fname = tc?.function?.name || 'unknown';
                let argsRaw = tc?.function?.arguments || '{}';
                let args;
                try { args = JSON.parse(argsRaw); } catch { args = {}; }
                const firstArgVal = args.path || Object.values(args)[0];
                const statusMsg = await message.channel.send(`⏳ ${fname}(${JSON.stringify(firstArgVal)})`);
                let result; let errored = false;
                try {
                    if (fname === 'read') {
                        const maxLen = typeof args.max_length === 'number' ? args.max_length : 10000;
                        if (!firstArgVal || typeof firstArgVal !== 'string') throw new Error('path required');
                        const resolved = path.resolve(root, firstArgVal);
                        if (!resolved.startsWith(root)) throw new Error('path outside root');
                        const stat = fs.statSync(resolved);
                        if (stat.isDirectory()) {
                            const entries = fs.readdirSync(resolved).slice(0, 200);
                            result = `Directory listing (first ${entries.length}):\n` + entries.join('\n');
                        } else {
                            let data = fs.readFileSync(resolved, 'utf8');
                            if (data.length > maxLen) data = data.slice(0, maxLen) + `\n...[truncated ${data.length - maxLen} bytes]`;
                            result = data;
                        }
                    } else {
                        result = 'Unsupported tool';
                    }
                } catch (e) {
                    errored = true;
                    result = `ERROR: ${e.message}`;
                }
                try { await statusMsg.edit(statusMsg.content.replace('⏳', errored ? '❌' : '✅')); } catch {/* ignore */}
                return { id: tc.id, result };
            });
            const results = await Promise.all(jobs);
            return results.reduce((acc, r) => { acc[r.id] = r.result; return acc; }, {});
        }

        // Call OpenAI (loop to handle tool calls) – limited iterations to prevent runaway
        let aiText = '';
        const maxIterations = 3;
        let iteration = 0;
        let messagesForApi = clonedPrompt.messages.map(m => ({ role: m.role, content: m.content }));
        while (iteration < maxIterations) {
            iteration += 1;
            let response;
            try {
                response = await openai.chat.completions.create({
                    model: clonedPrompt.model,
                    messages: messagesForApi
                });
                log.debug('openaiResponse', { iteration, response });
            } catch (err) {
                if (typingInterval) clearInterval(typingInterval);
                log.warn('openaiRequestFailed', { error: err.message });
                await message.channel.send('AI request failed.');
                return;
            }

            const msgObj = response.choices?.[0]?.message || {};
            const toolCalls = msgObj.tool_calls || msgObj.toolCalls || [];
            const content = msgObj.content || '';

            // Add assistant message (with potential tool calls) to conversation
            messagesForApi.push({
                role: 'assistant',
                content: typeof content === 'string' && content ? [{ type: 'text', text: content }] : (Array.isArray(content) ? content : []),
                tool_calls: toolCalls.length ? toolCalls : undefined
            });

            if (toolCalls.length) {
                // Execute tools in parallel
                const toolResults = await executeToolCalls(toolCalls);
                // Push each tool result
                toolCalls.forEach(tc => {
                    messagesForApi.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: [{ type: 'text', text: toolResults[tc.id] || '' }]
                    });
                });
                continue; // Next iteration to get final answer
            }

            // No tool calls; finalize if we have content
            aiText = (typeof content === 'string') ? content : Array.isArray(content) ? content.map(c => c.text || '').join('\n') : '';
            break;
        }

        if (typingInterval) clearInterval(typingInterval);
        aiText = (aiText || '(no response)').trim();
        if (!aiText) aiText = '(empty response)';

        const chunks = splitMsg(aiText, 2000);
        for (const part of chunks) {
            // eslint-disable-next-line no-await-in-loop
            await message.channel.send(part);
        }
        log.debug('openaiResponseSent', { parts: chunks.length, totalLength: aiText.length, iterations: iteration });
    } catch (err) {
        log.warn('messageCreateHandlerError', { error: err.message, messageId: message.id });
    }
}