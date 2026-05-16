import { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    UserSelectMenuBuilder
} from 'discord.js';
import config from '../config/config.js';
import { roomStates } from './voiceSystem.js';

const LOG_CHANNEL_ID = '1502767041793360115';
const panelCooldowns = new Map(); // channelId -> lastAttemptTimestamp

export function initVoicePanel(client) {
    console.log('[SYSTEM] Voice Control Panel System Rebuilt & Initialized');

    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isButton() && interaction.customId.startsWith('vp_')) {
                await handleVoiceButton(interaction);
            } else if (interaction.isModalSubmit() && interaction.customId.startsWith('vp_modal_')) {
                await handleVoiceModal(interaction);
            } else if (interaction.isUserSelectMenu() && interaction.customId.startsWith('vp_select_')) {
                await handleVoiceSelect(interaction);
            }
        } catch (err) {
            console.error('[VoicePanel] Interaction Error:', err);
            await logToStaff(interaction.client, `❌ **Panel Interaction Error**: ${err.message}`);
        }
    });
}

async function handleVoiceButton(interaction) {
    const { customId, guild, member, user, channel } = interaction;
    if (!member || !guild || !channel) return;

    const room = roomStates.get(channel.id);
    if (!room) return interaction.reply({ content: '❌ Room state not found.', flags: 64 });

    const isStaff = member.roles.cache.has(config.ROLES.OWNER_ROLE) || 
                    member.roles.cache.has(config.ROLES.ADMIN) ||
                    member.id === room.ownerId;

    if (!isStaff) {
        return interaction.reply({ content: '❌ You are not allowed to use this panel.', flags: 64 });
    }

    const action = customId.replace('vp_', '');

    try {
        switch (action) {
            case 'rename':
                const renameModal = new ModalBuilder()
                    .setCustomId('vp_modal_rename')
                    .setTitle('Rename Room');
                const nameInput = new TextInputBuilder()
                    .setCustomId('new_name')
                    .setLabel('New Channel Name')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('🔊 My Awesome Room')
                    .setRequired(true);
                renameModal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                await interaction.showModal(renameModal);
                return;

            case 'lock':
                await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });
                await interaction.reply({ content: '🔒 Channel locked for everyone.', flags: 64 });
                break;

            case 'unlock':
                await channel.permissionOverwrites.edit(guild.roles.everyone, { 
                    Connect: true,
                    ViewChannel: true 
                });
                await interaction.reply({ content: '🔓 Channel unlocked and reset to default open state.', flags: 64 });
                break;

            case 'transfer':
                if (channel.members.filter(m => !m.user.bot && m.id !== user.id).size === 0) {
                    return interaction.reply({ content: '❌ There are no other users in the voice channel to transfer ownership to.', flags: 64 });
                }
                const transferRow = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId('vp_select_transfer')
                        .setPlaceholder('Select the new owner...')
                );
                await interaction.reply({ content: '🔁 **Transfer Owner**: Select a user from the list below.', components: [transferRow], flags: 64 });
                return;

            case 'allow':
                const allowRow = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId('vp_select_allow')
                        .setPlaceholder('Select a user to allow...')
                );
                await interaction.reply({ content: '👤 **Allow User**: Select a user from the list below.', components: [allowRow], flags: 64 });
                return;

            case 'deny':
                const denyRow = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId('vp_select_deny')
                        .setPlaceholder('Select a user to deny...')
                );
                await interaction.reply({ content: '🚫 **Deny User**: Select a user from the list below.', components: [denyRow], flags: 64 });
                return;

            case 'info':
                const infoEmbed = new EmbedBuilder()
                    .setTitle('ℹ️ Room Information')
                    .addFields(
                        { name: '👤 Owner', value: `<@${room.ownerId}>`, inline: true },
                        { name: '📍 Channel', value: `<#${channel.id}>`, inline: true },
                        { name: '👥 Members', value: String(channel.members.filter(m => !m.user.bot).size), inline: true },
                        { name: '📅 Created', value: `<t:${Math.floor(room.createdAt / 1000)}:R>`, inline: true }
                    )
                    .setColor(config.BRANDING.COLOR);
                await interaction.reply({ embeds: [infoEmbed], flags: 64 });
                return;

            case 'refresh':
                await interaction.deferUpdate();
                await sendOrUpdatePanel(channel);
                return;

            case 'delete':
                if (user.id !== room.ownerId && !member.roles.cache.has(config.ROLES.ADMIN)) {
                    return interaction.reply({ content: '❌ Only the owner can delete the room.', flags: 64 });
                }
                await interaction.reply({ content: '🗑️ Room is being deleted...', flags: 64 });
                roomStates.delete(channel.id);
                await channel.delete().catch(() => {});
                await logToStaff(interaction.client, `🗑️ **Room Deleted**: <@${user.id}> deleted channel \`${channel.name}\``);
                return;
        }

        await sendOrUpdatePanel(channel);
        await logToStaff(interaction.client, `⚡ **Button Used**: <@${user.id}> used \`${action}\` in <#${channel.id}>`);

    } catch (err) {
        console.error(`[VoicePanel] Action Error (${action}):`, err);
        await interaction.reply({ content: `❌ Error executing ${action}.`, flags: 64 });
    }
}

async function handleVoiceSelect(interaction) {
    const { customId, guild, member, channel, users } = interaction;
    if (!member || !guild || !channel) return;

    const room = roomStates.get(channel.id);
    if (!room) return interaction.reply({ content: '❌ Room state not found.', flags: 64 });

    const targetUser = users.first();
    if (!targetUser) return interaction.reply({ content: '❌ No user selected.', flags: 64 });
    if (targetUser.bot) return interaction.reply({ content: '❌ Bots are excluded from this system.', flags: 64 });

    try {
        if (customId === 'vp_select_allow') {
            await channel.permissionOverwrites.edit(targetUser.id, { 
                ViewChannel: true, 
                Connect: true 
            });
            await interaction.reply({ content: `✅ <@${targetUser.id}> has been **allowed** in the room.`, flags: 64 });
            await logToStaff(interaction.client, `👤 **User Allowed**: <@${member.id}> allowed <@${targetUser.id}> in <#${channel.id}>`);
        }

        if (customId === 'vp_select_deny') {
            if (targetUser.id === room.ownerId) {
                return interaction.reply({ content: '❌ You cannot deny the room owner.', flags: 64 });
            }

            await channel.permissionOverwrites.edit(targetUser.id, { 
                Connect: false 
            });

            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (targetMember && targetMember.voice.channelId === channel.id) {
                await targetMember.voice.disconnect();
            }

            await interaction.reply({ content: `🚫 <@${targetUser.id}> has been **denied** from the room.`, flags: 64 });
            await logToStaff(interaction.client, `🚫 **User Denied**: <@${member.id}> denied <@${targetUser.id}> from <#${channel.id}>`);
        }

        if (customId === 'vp_select_transfer') {
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!targetMember || targetMember.voice.channelId !== channel.id) {
                return interaction.reply({ content: '❌ The selected user must be inside your voice channel to transfer ownership.', flags: 64 });
            }

            room.ownerId = targetUser.id;
            await channel.permissionOverwrites.edit(targetUser.id, { 
                ViewChannel: true, 
                Connect: true, 
                ManageChannels: true 
            });
            
            await interaction.reply({ content: `🔁 Ownership has been **transferred** to <@${targetUser.id}>.`, flags: 64 });
            await logToStaff(interaction.client, `🔁 **Ownership Transfer**: <@${member.id}> transferred ownership of <#${channel.id}> to <@${targetUser.id}>`);
        }

        await sendOrUpdatePanel(channel);
    } catch (err) {
        console.error('[VoicePanel] Select Error:', err);
        await interaction.reply({ content: `❌ Error: ${err.message}`, flags: 64 });
    }
}

async function handleVoiceModal(interaction) {
    const { customId, fields, member, guild, channel } = interaction;
    const room = roomStates.get(channel.id);
    if (!room) return interaction.reply({ content: '❌ Room state not found.', flags: 64 });

    await interaction.deferReply({ flags: 64 });

    try {
        if (customId === 'vp_modal_rename') {
            const newName = fields.getTextInputValue('new_name');
            await channel.setName(newName);
            await interaction.editReply(`✅ Room renamed to **${newName}**.`);
            await logToStaff(interaction.client, `✏️ **Room Renamed**: <@${member.id}> renamed room to \`${newName}\``);
        }

        await sendOrUpdatePanel(channel);
    } catch (err) {
        console.error('[VoicePanel] Modal Error:', err);
        await interaction.editReply(`❌ Modal processing failed: ${err.message}`);
    }
}

export function getVoicePanelEmbed(room, channel) {
    return new EmbedBuilder()
        .setTitle('🎛 Voice Room Control Panel')
        .addFields(
            { name: '👤 Owner', value: room ? `<@${room.ownerId}>` : 'Unknown', inline: true },
            { name: '🔊 Room', value: channel ? channel.name : 'Unknown', inline: true },
            { name: '👥 Members', value: channel ? `${channel.members.filter(m => !m.user.bot).size}` : '0', inline: true },
            { name: '🆔 Channel ID', value: channel ? `\`${channel.id}\`` : 'Unknown', inline: true }
        )
        .setColor(0x5865F2)
        .setTimestamp()
        .setFooter({ text: 'CollabHub Voice Management' });
}

export function getVoicePanelButtons() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vp_rename').setLabel('Rename').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
        new ButtonBuilder().setCustomId('vp_lock').setLabel('Lock').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('vp_unlock').setLabel('Unlock').setStyle(ButtonStyle.Success).setEmoji('🔓'),
        new ButtonBuilder().setCustomId('vp_transfer').setLabel('Transfer Owner').setStyle(ButtonStyle.Secondary).setEmoji('🔁')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vp_allow').setLabel('Allow User').setStyle(ButtonStyle.Secondary).setEmoji('👤'),
        new ButtonBuilder().setCustomId('vp_deny').setLabel('Deny User').setStyle(ButtonStyle.Secondary).setEmoji('🚫'),
        new ButtonBuilder().setCustomId('vp_info').setLabel('Info').setStyle(ButtonStyle.Secondary).setEmoji('ℹ️'),
        new ButtonBuilder().setCustomId('vp_refresh').setLabel('Refresh Panel').setStyle(ButtonStyle.Primary).setEmoji('📊')
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vp_delete').setLabel('Delete Room').setStyle(ButtonStyle.Danger).setEmoji('🗑')
    );

    return [row1, row2, row3];
}

export async function sendOrUpdatePanel(channel) {
    const room = roomStates.get(channel.id);
    if (!room) return;

    const now = Date.now();
    const lastAttempt = panelCooldowns.get(channel.id) || 0;
    if (now - lastAttempt < 5000) return;
    panelCooldowns.set(channel.id, now);

    const embed = getVoicePanelEmbed(room, channel);
    const components = getVoicePanelButtons();

    try {
        let panelMessage = null;
        if (room.panelMessageId) {
            panelMessage = await channel.messages.fetch(room.panelMessageId).catch(() => null);
        }

        if (panelMessage) {
            await panelMessage.edit({ embeds: [embed], components: components });
        } else {
            const messages = await channel.messages.fetch({ limit: 50 });
            const oldPanel = messages.find(m => m.author.id === channel.client.user.id && m.embeds[0]?.title === '🎛 Voice Room Control Panel');
            
            if (oldPanel) {
                room.panelMessageId = oldPanel.id;
                await oldPanel.edit({ embeds: [embed], components: components });
            } else {
                const doubleCheck = roomStates.get(channel.id);
                if (doubleCheck.panelMessageId) return;

                const newMsg = await channel.send({ embeds: [embed], components: components });
                room.panelMessageId = newMsg.id;
                await logToStaff(channel.client, `✨ **Panel Created**: New panel generated for <#${channel.id}>`);
            }
        }
    } catch (err) {
        console.error('[VoicePanel] sendOrUpdatePanel Error:', err);
    }
}

async function logToStaff(client, message) {
    try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🎛 Voice Panel Log')
                .setDescription(message)
                .setColor(0x5865F2)
                .setTimestamp();
            await logChannel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[VoicePanel] Log Error:', err);
    }
}
