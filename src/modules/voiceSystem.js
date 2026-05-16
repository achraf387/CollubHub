import { ChannelType, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import config from '../config/config.js';
import { sendOrUpdatePanel } from './voicePanel.js';

const ENTRY_CHANNEL_ID = '1505318219509137408';
const CATEGORY_ID = '1505317829329817770';
const LOG_CHANNEL_ID = '1502767041793360115';

// Mapping: channelId -> { ownerId, panelMessageId, createdAt }
export const roomStates = new Map();

export function initVoiceSystem(client) {
    console.log('[SYSTEM] Voice Auto-Move System Initialized');

    client.once('ready', async () => {
        await rebuildCache(client);
    });

    client.on('voiceStateUpdate', async (oldState, newState) => {
        try {
            const { member, guild, channelId: newChannelId } = newState;
            const { channelId: oldChannelId } = oldState;

            // BOT EXCLUSION
            if (member?.user.bot) return;

            // Detect join to ENTRY channel
            if (newChannelId === ENTRY_CHANNEL_ID && oldChannelId !== ENTRY_CHANNEL_ID) {
                console.log("[VOICE] User joined entry:", member?.id || 'Unknown');
                await handleEntryJoin(newState);
            }

            // Cleanup empty channels
            if (oldChannelId && oldChannelId !== newChannelId) {
                await handleChannelCleanup(oldState);
            }

            // Re-create panel if user joins their room and it's missing
            if (newChannelId && newChannelId !== ENTRY_CHANNEL_ID && roomStates.has(newChannelId)) {
                const room = roomStates.get(newChannelId);
                if (member.id === room.ownerId) {
                    const channel = guild.channels.cache.get(newChannelId);
                    if (channel) await sendOrUpdatePanel(channel);
                }
            }
        } catch (err) {
            console.error('[VoiceSystem] Event Error:', err);
        }
    });
}

async function handleEntryJoin(newState) {
    const { member, guild } = newState;
    if (!member || !guild) return;

    const userId = member.id;
    const channelName = `🔊 ${member.user.username}-room`;

    try {
        // STEP 1: Check if user already has a channel
        let existingChannelId = null;
        for (const [cId, state] of roomStates.entries()) {
            if (state.ownerId === userId) {
                existingChannelId = cId;
                break;
            }
        }

        if (existingChannelId) {
            const existingChannel = guild.channels.cache.get(existingChannelId);
            if (existingChannel) {
                console.log("[VOICE] User already has a channel, moving back:", existingChannelId);
                await member.voice.setChannel(existingChannel).catch(() => {});
                await sendOrUpdatePanel(existingChannel);
                return;
            } else {
                roomStates.delete(existingChannelId);
            }
        }

        // STEP 2: Permission Validation
        const botMember = await guild.members.fetchMe();
        const requiredPermissions = [
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect
        ];

        const missingPerms = requiredPermissions.filter(p => !botMember.permissions.has(p));
        if (missingPerms.length > 0) {
            const logMsg = `❌ Missing Permissions for Voice System: ${missingPerms.map(p => Object.keys(PermissionFlagsBits).find(key => PermissionFlagsBits[key] === p)).join(', ')}`;
            console.error(logMsg);
            await sendVoiceLog(guild.client, logMsg, 0xED4245);
            return;
        }

        // STEP 3: Create Private Voice Channel (OPEN BY DEFAULT)
        console.log("[VOICE] Creating channel:", channelName);
        const newChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: CATEGORY_ID,
            permissionOverwrites: [
                {
                    id: guild.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                },
                {
                    id: userId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.ManageChannels]
                },
                {
                    id: botMember.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers]
                }
            ]
        });

        // STEP 4: Store State
        roomStates.set(newChannel.id, {
            ownerId: userId,
            panelMessageId: null,
            createdAt: Date.now()
        });

        // STEP 5: Immediately Move User
        console.log("[VOICE] Moving user to:", newChannel.id);
        await member.voice.setChannel(newChannel);

        // STEP 6: Send Panel
        await sendOrUpdatePanel(newChannel);

        // LOG SUCCESS
        await sendVoiceLog(guild.client, `✅ Created channel <#${newChannel.id}> and moved <@${userId}>.`, 0x57F287);

    } catch (err) {
        console.error('[VoiceSystem] Join Handler Error:', err);
        await sendVoiceLog(guild.client, `❌ Failed to move <@${userId}>: ${err.message}`, 0xED4245);
    }
}

async function handleChannelCleanup(oldState) {
    const { channel, guild } = oldState;
    if (!channel || channel.parentId !== CATEGORY_ID || channel.id === ENTRY_CHANNEL_ID) return;

    try {
        // If channel is empty, delete it
        if (channel.members.size === 0) {
            console.log("[VOICE] Cleaning up empty channel:", channel.id);
            roomStates.delete(channel.id);
            await channel.delete().catch(() => {});
        }
    } catch (err) {
        console.error('[VoiceSystem] Cleanup Error:', err);
    }
}

async function rebuildCache(client) {
    try {
        const guild = client.guilds.cache.get(config.GUILD_ID);
        if (!guild) return;

        const category = guild.channels.cache.get(CATEGORY_ID);
        if (!category || category.type !== ChannelType.GuildCategory) return;

        const voiceChannels = guild.channels.cache.filter(c => c.parentId === CATEGORY_ID && c.type === ChannelType.GuildVoice && c.id !== ENTRY_CHANNEL_ID);
        
        for (const [id, channel] of voiceChannels) {
            // Find the user who has ManageChannels permission in this channel
            const ownerOverwrite = channel.permissionOverwrites.cache.find(ov => ov.type === 1 && ov.allow.has(PermissionFlagsBits.ManageChannels));
            if (ownerOverwrite) {
                roomStates.set(channel.id, {
                    ownerId: ownerOverwrite.id,
                    panelMessageId: null,
                    createdAt: channel.createdAt?.getTime() || Date.now()
                });
                // Try to find existing panel
                await sendOrUpdatePanel(channel);
            }

            // Cleanup if empty on startup
            if (channel.members.size === 0) {
                roomStates.delete(channel.id);
                await channel.delete().catch(() => {});
            }
        }
        console.log(`[VOICE] Cache rebuilt: ${roomStates.size} active channels found.`);
    } catch (err) {
        console.error('[VoiceSystem] Cache Rebuild Error:', err);
    }
}

async function sendVoiceLog(client, message, color) {
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('🎙️ Voice System Log')
                .setDescription(message)
                .setColor(color)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[VoiceSystem] Logging Error:', err);
    }
}
