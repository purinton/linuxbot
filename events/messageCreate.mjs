// events/messageCreate.
import { handle } from '../src/messageCreate/messageHandle.mjs';
export default async function ({ client, log, openai, promptConfig, allowIds }, message) {
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

        handle({ client, log, openai, promptConfig, message });
    } catch (err) {
        log.error('messageCreateError', { error: err.message });
    }
}