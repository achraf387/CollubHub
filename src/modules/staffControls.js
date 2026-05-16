import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import config from '../config/config.js';

const logChannelId = '1502767041793360115';

// Global Map: voiceChannelId -> { messageId, createdAt, lastUsedAt }
export const staffPanels = new Map();

export function initStaffControls(client) {
    console.log('[SYSTEM] Staff Voice Control System Rebuilt & Initialized');

    client.once('ready', async () => {
        try {
            const channel = await client.channels.fetch(logChannelId).catch(() => null);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('🛡️ System Rebuild')
                    .setDescription('✅ **Staff Voice Controls Reinitialized**\n✅ **Duplicate Panel Guard Active**\n✅ **Bot exclusion rules applied**')
                    .setColor(0x57F287)
                    .setTimestamp();
                await channel.send({ embeds: [embed] });
            }
        } catch (err) {
            console.error('[StaffControls] Rebuild log failed:', err);
        }
    });

    // Auto-trigger panel when staff joins voice
    client.on('voiceStateUpdate', async (oldState, newState) => {
        try {
            const { member, guild, channelId: newChannelId } = newState;
            if (!member || !guild || !newChannelId || member.user.bot) return;

            // STAFF CHECK: Owner or Admin Role
            const isStaff = member.roles.cache.has(config.ROLES.OWNER_ROLE) || 
                            member.roles.cache.has(config.ROLES.ADMIN);

            if (isStaff && oldState.channelId !== newChannelId) {
                const channel = guild.channels.cache.get(newChannelId);
                if (channel) await sendOrUpdateStaffPanel(channel);
            }
        } catch (err) {
            console.error('[StaffControls] VoiceUpdate Error:', err);
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton() || !interaction.customId.startsWith('staff_')) return;

        try {
            const { customId, guild, member, user, channel } = interaction;

            // SAFE CHECK (MANDATORY)
            if (!member || !member.roles || !guild || !channel) return;

            // STAFF CHECK: Owner or Admin Role
            const isStaff = member.roles.cache.has(config.ROLES.OWNER_ROLE) || 
                            member.roles.cache.has(config.ROLES.ADMIN);

            if (!isStaff) {
                return interaction.reply({ content: '❌ Only Staff members can use these controls.', flags: 64 });
            }

            await interaction.deferReply({ flags: 64 });

            const [prefix, action, channelId] = customId.split('_');
            const targetChannel = guild.channels.cache.get(channelId) || channel;

            const members = Array.from(targetChannel.members.values());
            let affectedCount = 0;

            if (action === 'mute') {
                for (const m of members) {
                    // BOT EXCLUSION MANDATORY
                    if (m.user.bot) continue;

                    // STAFF IMMUNITY
                    const mIsStaff = m.roles.cache.has(config.ROLES.OWNER_ROLE) || 
                                     m.roles.cache.has(config.ROLES.ADMIN);
                    
                    if (m.id !== user.id && !mIsStaff && !m.voice.serverMute) {
                        await m.voice.setMute(true, `Staff Mute All by ${user.tag}`).catch(() => {});
                        affectedCount++;
                    }
                }
                await interaction.editReply(`🔇 Successfully muted **${affectedCount}** non-staff members.`);
            } else if (action === 'unmute') {
                for (const m of members) {
                    // BOT EXCLUSION MANDATORY
                    if (m.user.bot) continue;

                    if (m.voice.serverMute) {
                        await m.voice.setMute(false, `Staff Unmute All by ${user.tag}`).catch(() => {});
                        affectedCount++;
                    }
                }
                await interaction.editReply(`🔊 Successfully unmuted **${affectedCount}** non-staff members.`);
            }

            // Update Panel to reflect state (Refresh)
            await sendOrUpdateStaffPanel(targetChannel);

            // Log Action
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle(`🛡️ Staff Action: ${action.toUpperCase()} ALL`)
                    .addFields(
                        { name: '🛡️ Staff', value: `<@${user.id}>`, inline: true },
                        { name: '📍 Channel', value: `<#${targetChannel.id}>`, inline: true },
                        { name: '👥 Affected', value: String(affectedCount), inline: true }
                    )
                    .setColor(action === 'mute' ? 0xED4245 : 0x57F287)
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

        } catch (err) {
            console.error('[StaffControls] Action Error:', err);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('❌ Action failed.');
            } else {
                await interaction.reply({ content: '❌ Action failed.', flags: 64 });
            }
        }
    });
}

export async function sendOrUpdateStaffPanel(channel) {
    if (!channel) return;

    try {
        const now = Date.now();
        const state = staffPanels.get(channel.id);

        // DEBOUNCE: 5-10 seconds per channel
        if (state && now - (state.lastUsedAt || 0) < 5000) {
            console.log(`[StaffControls] Blocked duplicate/spam send for channel ${channel.id}`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Staff Voice Controls')
            .setDescription(`Manage all members in **${channel.name}**.\n\n` +
                `🔇 **Mute All**: Mutes everyone except Staff and Bots.\n` +
                `🔊 **Unmute All**: Unmutes everyone except Bots.`)
            .addFields(
                { name: '👥 Total Members', value: String(channel.members.size), inline: true },
                { name: '🤖 Bots', value: String(channel.members.filter(m => m.user.bot).size), inline: true }
            )
            .setColor(0xED4245)
            .setFooter({ text: 'CollabHub Staff Protection' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`staff_mute_${channel.id}`).setLabel('Mute All').setStyle(ButtonStyle.Danger).setEmoji('🔇'),
            new ButtonBuilder().setCustomId(`staff_unmute_${channel.id}`).setLabel('Unmute All').setStyle(ButtonStyle.Success).setEmoji('🔊')
        );

        let panelMessage = null;
        if (state && state.messageId) {
            panelMessage = await channel.messages.fetch(state.messageId).catch(() => null);
        }

        if (panelMessage) {
            // REUSE SAME PANEL FOREVER (EDIT)
            await panelMessage.edit({ embeds: [embed], components: [row] });
            staffPanels.set(channel.id, { ...state, lastUsedAt: now });
            console.log(`[StaffControls] Reused staff panel in ${channel.id}`);
        } else {
            // HARD GUARD: Final check before sending to prevent duplicate
            const doubleCheck = staffPanels.get(channel.id);
            if (doubleCheck && doubleCheck.messageId) return;

            // Search history for orphaned panels before sending new one
            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => []);
            const oldPanel = Array.from(messages.values()).find(m => m.author.id === channel.client.user.id && m.embeds[0]?.title === '🛡️ Staff Voice Controls');
            
            if (oldPanel) {
                await oldPanel.edit({ embeds: [embed], components: [row] });
                staffPanels.set(channel.id, { messageId: oldPanel.id, createdAt: oldPanel.createdAt.getTime(), lastUsedAt: now });
                console.log(`[StaffControls] Adopted orphaned staff panel in ${channel.id}`);
            } else {
                const newMsg = await channel.send({ embeds: [embed], components: [row] });
                staffPanels.set(channel.id, { messageId: newMsg.id, createdAt: now, lastUsedAt: now });
                console.log(`[StaffControls] Created new staff panel in ${channel.id}`);
                
                // Log Creation
                const logChannel = await channel.client.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    await logChannel.send({ embeds: [new EmbedBuilder().setDescription(`✨ **Staff Panel Created** in <#${channel.id}>`).setColor(0x5865F2)] });
                }
            }
        }
    } catch (err) {
        console.error('[StaffControls] sendOrUpdateStaffPanel Error:', err);
    }
}

export function getStaffButtons(channelId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`staff_mute_${channelId}`)
            .setLabel('Mute All')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔇'),
        new ButtonBuilder()
            .setCustomId(`staff_unmute_${channelId}`)
            .setLabel('Unmute All')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔊')
    );
}
