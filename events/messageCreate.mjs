// events/messageCreate.mjs
import { splitMsg } from '@purinton/discord';
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

        // Build conversation messages
        const conversationMessages = history.map(m => {
            const role = m.author?.id === client.user.id ? 'assistant' : 'user';
            let text = (m.cleanContent || m.content || '').trim();
            if (!text) return null; // skip empty
            // Optionally include author tag for user messages to help threading
            if (role === 'user') {
                text = `${m.author.username}: ${text}`;
            }
            return {
                role,
                content: [
                    { type: 'input_text', text }
                ]
            };
        }).filter(Boolean);

        // Clone promptConfig (it's frozen) and append history
        const baseMessages = promptConfig.input.map(m => ({
            role: m.role,
            content: m.content.map(c => ({ ...c }))
        }));

        const input = [...baseMessages, ...conversationMessages];

        // Call OpenAI Responses API (assuming @purinton/openai exposes responses.create)
        let response;
        try {
            response = await openai.responses.create({
                model: promptConfig.model,
                input
            });
        } catch (err) {
            log.warn('openaiRequestFailed', { error: err.message });
            await message.channel.send('AI request failed.');
            return;
        }

        // Extract assistant reply text
        let aiText = '';
        try {
            if (response.output_text) {
                aiText = response.output_text;
            } else if (Array.isArray(response.output)) {
                aiText = response.output
                    .map(block => Array.isArray(block.content) ? block.content.map(c => c.text || '').join('') : '')
                    .join('\n');
            } else if (Array.isArray(response.content)) {
                aiText = response.content.map(c => c.text || '').join('\n');
            } else if (response.text) {
                aiText = response.text;
            }
        } catch (err) {
            log.debug('responseParseError', { error: err.message });
        }

        aiText = (aiText || '(no response)').trim();
        if (!aiText) aiText = '(empty response)';

        // Split and send using shared splitter
        const chunks = splitMsg(aiText, 2000);
        for (const part of chunks) {
            // eslint-disable-next-line no-await-in-loop
            await message.channel.send(part);
        }
        log.debug('openaiResponseSent', { parts: chunks.length, totalLength: aiText.length });
    } catch (err) {
        log.warn('messageCreateHandlerError', { error: err.message, messageId: message.id });
    }
}