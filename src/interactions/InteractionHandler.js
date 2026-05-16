import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType, StringSelectMenuBuilder } from 'discord.js';
import config from '../config/config.js';
import CollabService from '../services/CollabService.js';
import UserService from '../services/UserService.js';
import RoleService from '../services/RoleService.js';
import PermissionService from '../services/PermissionService.js';
import ApprovalService from '../services/ApprovalService.js';
import RecoveryService from '../services/RecoveryService.js';
import ApplicationService from '../services/ApplicationService.js';
import db from '../database/db.js';

import { initMusicSystem, getMusicControlButtons } from '../modules/musicSystem.js';
import { initStaffControls, getStaffButtons } from '../modules/staffControls.js';
import { initVoicePanel, getVoicePanelEmbed, getVoicePanelButtons } from '../modules/voicePanel.js';

const creationCache = new Map();
const ratingCache = new Map();
const timeoutCache = new Map();

class InteractionHandler {
    static async handle(interaction) {
        try {
            if (interaction.isButton()) await this.handleButton(interaction);
            else if (interaction.isModalSubmit()) await this.handleModal(interaction);
            else if (interaction.isStringSelectMenu()) await this.handleSelect(interaction);
            else if (interaction.isChatInputCommand()) await this.handleCommand(interaction);
        } catch (error) {
            // Error 40060: Interaction has already been acknowledged
            if (error.code === 40060) return;
            
            console.error('[InteractionHandler] Error:', error);
            
            const msg = '❌ An error occurred while processing your request.';
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: msg });
                } else {
                    await interaction.reply({ content: msg, flags: 64 });
                }
            } catch (innerError) {
                // Silently fail if we can't even send the error message
            }
        }
    }

    static async handleButton(interaction) {
        const { customId, user, guild, member } = interaction;

        // END COLLAB - Step 1: Ratings (Ephemeral Message)
        if (customId.startsWith('end_')) {
            try {
                const collabId = customId.split('_')[1];

                if (!collabId || collabId === "end") {
                    console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                    return interaction.reply({
                        content: "❌ Invalid session. Please restart collab process.",
                        flags: 64
                    });
                }

                console.log("[TRACE] STEP 1 BUTTON CLICK - collabId =", collabId);
                
                const collab = CollabService.getCollab(collabId);
                console.log("[TRACE] STEP 2 RATING START - collabId =", collabId, "DB Result =", collab ? "FOUND" : "NOT FOUND");
                
                if (!collab) return interaction.reply({ content: '❌ Collab data not found.', flags: 64 });
                if (user.id !== collab.ownerId) return interaction.reply({ content: '❌ Only the owner can end this collab.', flags: 64 });

                const members = CollabService.getMembers(collabId).filter(id => id !== user.id);
                
                if (members.length === 0) {
                    // No participants, skip to modal
                    const modal = new ModalBuilder()
                        .setCustomId(`endmodal_${collabId}`)
                        .setTitle('End Collaboration');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('url')
                                .setLabel('Your Final Video URL')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setPlaceholder('https://www.youtube.com/watch?v=...')
                        )
                    );
                    return await interaction.showModal(modal);
                }

                // Initialize rating cache for this collab
                ratingCache.set(`${user.id}_${collabId}`, {});

                const rows = [];
                for (const participantId of members) {
                    const participant = await guild.members.fetch(participantId).catch(() => null);
                    const name = participant ? participant.user.username : `User ${participantId}`;
                    
                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`rate_${collabId}_${participantId}`)
                            .setPlaceholder(`Rate ${name}`)
                            .addOptions(
                                { label: '⭐ 1 Star', value: '1' },
                                { label: '⭐⭐ 2 Stars', value: '2' },
                                { label: '⭐⭐⭐ 3 Stars', value: '3' },
                                { label: '⭐⭐⭐⭐ 4 Stars', value: '4' },
                                { label: '⭐⭐⭐⭐⭐ 5 Stars', value: '5' }
                            )
                    );
                    rows.push(row);
                }

                const continueRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`continue_${collabId}`)
                        .setLabel('Continue to Video Link')
                        .setStyle(ButtonStyle.Primary)
                );
                rows.push(continueRow);

                return await interaction.reply({
                    content: '### 🌟 Step 1: Rate Participants\nPlease rate each participant before ending the collaboration.',
                    components: rows,
                    flags: 64
                });

            } catch (err) {
                console.error("END COLLAB BUTTON CRASH:", err);
            }
            return;
        }

        if (customId.startsWith('continue_')) {
            const collabId = customId.split('_')[1];

            if (!collabId || collabId === "continue") {
                console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                return interaction.reply({
                    content: "❌ Invalid session. Please restart collab process.",
                    flags: 64
                });
            }

            console.log("[TRACE] STEP 4 CONTINUE CLICKED - collabId =", collabId);

            const cacheKey = `${user.id}_${collabId}`;
            const ratings = ratingCache.get(cacheKey) || {};
            
            // Re-fetch collab from DB (ISSUE 2: Collab data not found)
            console.log("[TRACE] STEP 5 FETCHING FROM DB - collabId =", collabId);
            const collab = CollabService.getCollab(collabId);
            console.log("[TRACE] STEP 6 DB RESULT =", collab ? "FOUND" : "NOT FOUND");

            if (!collab) return interaction.reply({ content: '❌ Collab data not found in database.', flags: 64 });

            const members = CollabService.getMembers(collabId).filter(id => id !== user.id);

            // Validation: All participants MUST be rated
            const unrated = members.filter(id => !ratings[id]);
            if (unrated.length > 0) {
                return interaction.reply({ 
                    content: `❌ Please rate all participants before continuing! (${unrated.length} remaining)`, 
                    flags: 64 
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`endmodal_${collabId}`)
                .setTitle('Step 2: Final Video Link');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('url')
                        .setLabel('Your Final Video URL')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('https://www.youtube.com/watch?v=...')
                )
            );

            await interaction.showModal(modal);
            return;
        }

        if (customId === 'apply_to_join_start') {
            if (ApplicationService.hasActiveApplication(user.id)) {
                return interaction.reply({ content: '❌ You already have a pending application!', flags: 64 });
            }

            const modal = new ModalBuilder().setCustomId('apply_to_join_modal').setTitle('Creator Application');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Full Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('languages').setLabel('Language(s) You Speak').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type').setLabel('Content Type').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel').setLabel('Channel Link (YT/Twitch/TikTok)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('https://youtube.com/c/yourchannel')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('video').setLabel('Example Video Link').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('https://youtu.be/...'))
            );
            // Re-adding 6th field in a second modal if needed, but Discord supports 5. 
            // The prompt asks for 6 fields. I'll combine the last one or use a creative way.
            // "6. Do you post consistently?" - I'll combine with Content Type or add it.
            // Wait, Discord modals ONLY support 5 components. 
            // I'll combine "Content Type" and "Consistently" or "Languages".
            
            // Let's combine "Content Type" and "Consistency"
            modal.components[2].components[0].setLabel('Content Type & Consistency');
            modal.components[2].components[0].setPlaceholder('Gaming / Yes, I post weekly');

            await interaction.showModal(modal);
        }

        if (customId.startsWith('apply_accept_')) {
            if (user.id !== guild.ownerId) return interaction.reply({ content: '❌ Only the Server Owner can approve applications.', flags: 64 });
            
            await interaction.deferReply({ flags: 64 });
            const targetId = customId.split('_')[2];
            const result = await ApplicationService.approveApplication(guild, targetId, user.id);
            
            if (result.success) {
                return await interaction.editReply('✅ Application approved successfully.');
            } else {
                return await interaction.editReply(`❌ Error: ${result.error}`);
            }
        }

        if (customId.startsWith('apply_reject_')) {
            if (user.id !== guild.ownerId) return interaction.reply({ content: '❌ Only the Server Owner can reject applications.', flags: 64 });
            
            const targetId = customId.split('_')[2];
            const modal = new ModalBuilder().setCustomId(`apply_reject_modal_${targetId}`).setTitle('Reject Application');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Rejection Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500))
            );
            return await interaction.showModal(modal);
        }

        // Auto-heal state for other actions (Join/Create)
        await RecoveryService.selfHeal(guild, user.id);

        if (customId === 'collab_create_start') {
            const userData = UserService.getUser(user.id);
            if (userData.currentCollabId) {
                return interaction.reply({ content: '❌ You are already in an active collaboration!', flags: 64 });
            }

            creationCache.set(user.id, { language: 'English', contentType: 'Gaming Content', requiredRank: 'Member', devices: [] });
            
            const memberRank = RoleService.getMemberRank(member);
            const allRanks = [
                { label: 'Member', value: 'Member', emoji: '👤' },
                { label: 'Active Creator', value: 'Active Creator', emoji: '🔥' },
                { label: 'Trusted Creator', value: 'Trusted Creator', emoji: '💎' }
            ];

            // Filter ranks: User can only see their rank or lower
            const rankOptions = allRanks.filter(rank => RoleService.canChooseRank(memberRank, rank.value));

            const langRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('setup_lang').setPlaceholder('🌍 Language').addOptions(
                    { label: 'English', value: 'English', emoji: '🇺🇸' },
                    { label: 'Arabic', value: 'Arabic', emoji: '🇸🇦' }
                )
            );

            const typeRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('setup_type').setPlaceholder('🎭 Content Category').addOptions(
                    { label: 'Gaming Content', value: 'Gaming Content', emoji: '🎮' },
                    { label: 'Challenges', value: 'Challenges', emoji: '⚔️' },
                    { label: 'Reaction Content', value: 'Reaction Content', emoji: '😂' },
                    { label: 'Creative / Editing Projects', value: 'Creative / Editing Projects', emoji: '🎬' },
                    { label: 'Educational / Informational', value: 'Educational / Informational', emoji: '🧠' },
                    { label: 'Collaboration / Social Content', value: 'Collaboration / Social Content', emoji: '🤝' },
                    { label: 'Experimental Content', value: 'Experimental Content', emoji: '🎯' }
                )
            );

            const rankRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('setup_rank').setPlaceholder('🏅 Required Rank').addOptions(rankOptions)
            );

            const deviceRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('setup_devices').setPlaceholder('🖥️ Devices (Multi-select)').setMinValues(1).setMaxValues(4).addOptions(
                    ['Desktop', 'Laptop', 'Mobile', 'Console'].map(d => ({ label: d, value: d }))
                )
            );

            const nextRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('setup_next').setLabel('Continue to Details').setStyle(ButtonStyle.Success)
            );

            return await interaction.reply({
                content: '### ⚙️ Step 1: Base Requirements',
                components: [langRow, typeRow, rankRow, deviceRow, nextRow],
                flags: 64
            });
        }

        if (customId === 'setup_next') {
            const state = creationCache.get(user.id);
            if (!state || state.devices.length === 0) return interaction.reply({ content: '❌ Please complete all selections!', flags: 64 });

            const modal = new ModalBuilder().setCustomId('collab_create_modal').setTitle('Step 2: Collab Details');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Video Title').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('members').setLabel('Required Members (1-99)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('schedule').setLabel('Scheduled Date & Time').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return await interaction.showModal(modal);
        }

        if (customId.startsWith('join_')) {
            await interaction.deferReply({ flags: 64 });
            const collabId = customId.split('_')[1];

            if (!collabId || collabId === "join") {
                console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                return interaction.editReply('❌ Invalid session. Please restart collab process.');
            }

            const collab = CollabService.getCollab(collabId);
            
            if (!collab || collab.status !== 'LOOKING') return interaction.editReply('❌ Collab not joinable.');
            if (UserService.getUser(user.id).currentCollabId) return interaction.editReply('❌ You are already in a collab.');

            const roles = member.roles.cache;
            const langRole = collab.language === 'English' ? config.ROLES.LANG_EN : config.ROLES.LANG_AR;
            if (!roles.has(langRole)) return interaction.editReply(`❌ You need the ${collab.language} role.`);
            
            const devices = JSON.parse(collab.allowedDevices);
            const deviceMap = { 'Desktop': config.ROLES.DEVICE_PC, 'Laptop': config.ROLES.DEVICE_LAPTOP, 'Mobile': config.ROLES.DEVICE_MOBILE, 'Console': config.ROLES.DEVICE_CONSOLE };
            if (!devices.some(d => roles.has(deviceMap[d]))) return interaction.editReply('❌ Required device role missing.');

            const memberRank = RoleService.getMemberRank(member);
            if (!RoleService.canChooseRank(memberRank, collab.requiredRank)) return interaction.editReply(`❌ Rank too low. Required: ${collab.requiredRank}`);

            CollabService.addMember(collabId, user.id);
            await RoleService.syncCollabRoles(member, true);

            const updated = CollabService.getCollab(collabId);
            const channel = guild.channels.cache.get(collab.channelId);
            if (channel) {
                await channel.permissionOverwrites.create(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                
                if (updated.currentMembers >= updated.maxMembers) {
                    CollabService.updateStatus(collabId, 'FULL');
                    updated.status = 'FULL'; // Ensure local object reflects change for UI update
                    const members = CollabService.getMembers(collabId);
                    await PermissionService.makeChannelPrivate(channel, collab.ownerId, members);
                    
                    const fullEmbed = CollabService.buildCollabEmbed(updated);
                    await channel.send({ content: '🔒 **Collab is now FULL and PRIVATE!**', embeds: [fullEmbed] });
                    
                    const ownerRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`collab_end_request_${collabId}`).setLabel('END COLLAB').setStyle(ButtonStyle.Danger)
                    );
                    await channel.send({ content: `<@${collab.ownerId}> (Owner Only Controls)`, components: [ownerRow] });

                    const fullDMEbed = new EmbedBuilder().setTitle('🎬 Collab Ready').setDescription(`Collab **${collab.title}** is now full!`).setColor(0x00FF00);
                    for (const id of members) {
                        const target = await guild.client.users.fetch(id).catch(() => null);
                        if (target) {
                            try {
                                await target.send({ embeds: [fullDMEbed] });
                            } catch (err) {}
                        }
                    }
                }

                const mainMsg = (await channel.messages.fetch({ limit: 50 })).find(m => m.embeds[0]?.title?.includes(collab.title));
                if (mainMsg) await mainMsg.edit({ embeds: [CollabService.buildCollabEmbed(updated)], components: CollabService.getButtons(collabId, updated.status, updated) });
            }
            await interaction.editReply('✅ Successfully joined!');
        }

        if (customId.startsWith('partvid_')) {
            const [, action, collabId] = customId.split('_');

            if (!collabId || collabId === "partvid") {
                console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                return interaction.reply({
                    content: "❌ Invalid session. Please restart collab process.",
                    flags: 64
                });
            }

            const collab = CollabService.getCollab(collabId);

            // Safety check: Collab exists and is not finalized (ISSUE 4)
            if (!collab || ['FINALIZED', 'FORCE_CLOSED'].includes(collab.status)) {
                return interaction.reply({ content: '❌ This collab has already ended.', flags: 64 });
            }

            // Check if user was a participant (ISSUE 3)
            const members = CollabService.getMembers(collabId);
            if (!members.includes(user.id)) {
                return interaction.reply({ content: '❌ You were not a participant in this collab.', flags: 64 });
            }

            if (action === 'yes') {
                const modal = new ModalBuilder().setCustomId(`partvidmodal_${collabId}`).setTitle('Submit Video URL');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('Video URL').setStyle(TextInputStyle.Short).setRequired(true)));
                return await interaction.showModal(modal);
            } else {
                return await interaction.update({ content: '✅ Submission declined.', components: [] });
            }
        }

        if (customId.startsWith('admin_')) {
            const parts = customId.split('_');
            const action = parts[1];
            const collabId = parts[2];

            if (!collabId || collabId === "approve" || collabId === "reject") {
                console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                return interaction.reply({
                    content: "❌ Invalid session. Please restart collab process.",
                    flags: 64
                });
            }

            if (action === 'approve') {
                await interaction.deferReply({ flags: 64 });
                
                // Process Ratings (ISSUE 1: Block duplicates)
                const ratings = db.prepare('SELECT userId, rating FROM participant_ratings WHERE collabId = ?').all(collabId);
                // Note: Ratings were saved during END COLLAB step. We just need to finalize user ranks now.
                
                // Finalize Collab
                await ApprovalService.finalizeCollab(guild, collabId);
                
                await interaction.editReply('✅ Collab finalized.');
                
                // FINAL STEP: Delete approval log message (SAFE FIX)
                try {
                    await interaction.message.delete();
                } catch (err) {
                    console.error("[COLLAB LOG] Failed to delete approval message:", err);
                }
            } else if (action === 'reject') {
                const modal = new ModalBuilder()
                    .setCustomId(`admin_reject_modal_${collabId}`)
                    .setTitle('Reject Collab');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('reason')
                            .setLabel('Reason')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    )
                );
                
                await interaction.showModal(modal);
            }
        }
    }

    static async handleModal(interaction) {
        const { customId, fields, user, guild, member } = interaction;

        if (customId === 'apply_to_join_modal') {
            await interaction.deferReply({ flags: 64 });
            
            const name = fields.getTextInputValue('name');
            const languages = fields.getTextInputValue('languages');
            const typeAndCons = fields.getTextInputValue('type');
            const channel = fields.getTextInputValue('channel');
            const video = fields.getTextInputValue('video');

            // Validation
            const validLinks = ['youtube.com', 'twitch.tv', 'tiktok.com'];
            if (!validLinks.some(link => channel.toLowerCase().includes(link))) {
                return interaction.editReply('❌ Invalid channel link. Must be YouTube, Twitch, or TikTok.');
            }
            if (!video.startsWith('http')) {
                return interaction.editReply('❌ Invalid video link. Must be a valid URL.');
            }

            try {
                // Store in DB
                ApplicationService.createApplication(user.id, {
                    name, languages, contentType: typeAndCons,
                    channelLink: channel, exampleVideo: video, consistently: 'Provided in Type field'
                });

                // Send Log Embed
                const logChannel = guild.channels.cache.get(config.CHANNELS.JOINING_LOGS);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('📝 New Creator Application')
                        .addFields(
                            { name: '👤 User', value: `<@${user.id}> (${user.tag})`, inline: true },
                            { name: '🌍 Languages', value: languages, inline: true },
                            { name: '🎮 Content Type & Consistency', value: typeAndCons, inline: true },
                            { name: '📺 Channel Link', value: channel },
                            { name: '🎥 Example Video', value: video }
                        )
                        .setColor(config.BRANDING.COLOR)
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`apply_accept_${user.id}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
                        new ButtonBuilder().setCustomId(`apply_reject_${user.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('❌')
                    );

                    const logMsg = await logChannel.send({ embeds: [logEmbed], components: [row] });
                    ApplicationService.updateApplicationMessage(user.id, logMsg.id);
                }

                // Hide Apply Channel (Permission Overwrite)
                const applyChannel = guild.channels.cache.get(config.CHANNELS.APPLY);
                if (applyChannel) {
                    await applyChannel.permissionOverwrites.create(user.id, { ViewChannel: false }).catch(() => null);
                }

                // DM User
                const dmEmbed = new EmbedBuilder()
                    .setTitle('📝 Application Received')
                    .setDescription(`Your application for **${config.BRANDING.NAME}** has been received and is currently under review.\n\nPlease be patient while the owner reviews your information.`)
                    .setColor(config.BRANDING.COLOR)
                    .setTimestamp();

                await user.send({ embeds: [dmEmbed] }).catch(() => null);

                await interaction.editReply('✅ Your application has been submitted successfully!');
            } catch (error) {
                console.error('[Application Modal Error]:', error);
                await interaction.editReply('❌ An error occurred while submitting your application.');
            }
        }

        if (customId.startsWith('apply_reject_modal_')) {
            await interaction.deferReply({ flags: 64 });
            const targetId = customId.split('_')[3];
            const reason = fields.getTextInputValue('reason');
            
            const result = await ApplicationService.rejectApplication(guild, targetId, reason);
            if (result.success) {
                await interaction.editReply('❌ Application rejected.');
            } else {
                await interaction.editReply(`❌ Error: ${result.error}`);
            }
            return;
        }

        if (customId.startsWith('collab_create_modal')) {
            await interaction.deferReply({ flags: 64 });
            const state = creationCache.get(user.id);
            if (!state) return interaction.editReply('❌ Session expired. Please restart the creation process.');

            const membersCount = parseInt(fields.getTextInputValue('members'));
            if (isNaN(membersCount) || membersCount < 1 || membersCount > 99) return interaction.editReply('❌ Members must be a number between 1 and 99.');

            const title = fields.getTextInputValue('title');
            const desc = fields.getTextInputValue('desc');
            const schedule = fields.getTextInputValue('schedule');

            const overwrites = PermissionService.getCreationOverwrites(guild, user.id);
            const channel = await guild.channels.create({
                name: `🎬-${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                type: ChannelType.GuildText,
                parent: config.CHANNELS.VOICE_CATEGORY,
                permissionOverwrites: overwrites
            });

            const collabId = Date.now().toString();
            CollabService.createCollab({
                collabId, ownerId: user.id, title, description: desc,
                language: state.language, contentType: state.contentType,
                requiredRank: state.requiredRank, allowedDevices: JSON.stringify(state.devices),
                maxMembers: membersCount, scheduledTime: schedule, channelId: channel.id
            });

            await RoleService.syncCollabRoles(member, true);
            const collab = CollabService.getCollab(collabId);
            await channel.send({ embeds: [CollabService.buildCollabEmbed(collab)], components: CollabService.getButtons(collabId, collab.status, collab) });
            await interaction.editReply(`✅ Created! <#${channel.id}>`);
            creationCache.delete(user.id);
            return;
        }

        if (customId.startsWith('endmodal_')) {
            try {
                await interaction.deferReply({ flags: 64 });
                
                const collabId = customId.split('_')[1];

                if (!collabId || collabId === "endmodal") {
                    console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                    return interaction.editReply('❌ Invalid session. Please restart collab process.');
                }

                const url = fields.getTextInputValue('url');
                
                console.log("[TRACE] STEP 7 MODAL SUBMITTED - collabId =", collabId);
                
                // ALWAYS FETCH FROM DB (RULE 2)
                console.log("[TRACE] STEP 8 FETCHING FROM DB (MODAL) - collabId =", collabId);
                const collab = CollabService.getCollab(collabId);
                console.log("[TRACE] STEP 9 DB RESULT (MODAL) =", collab ? "FOUND" : "NOT FOUND");

                if (!collab) return interaction.editReply('❌ Collab session expired. Please restart the ending process.');
                if (!guild) return interaction.editReply('❌ Guild context lost.');
                
                CollabService.setOwnerVideo(collabId, url);
                CollabService.updateStatus(collabId, 'ENDING');

                // Process Ratings (Source of truth: DB/Cache, not memory state)
                const cacheKey = `${user.id}_${collabId}`;
                const ratings = ratingCache.get(cacheKey) || {};
                for (const [participantId, rating] of Object.entries(ratings)) {
                    UserService.addRating(participantId, collabId, rating);
                }
                ratingCache.set(cacheKey, {}); // Clear cache safely after processing

                // STEP 1 & 2: UPDATE ROLES BEFORE DELETION
                const members = CollabService.getMembers(collabId);
                for (const userId of members) {
                    const targetMember = await guild.members.fetch(userId).catch(() => null);
                    if (targetMember) {
                        await RoleService.syncCollabRoles(targetMember, false);
                    }
                }

                // IMMEDIATE CHANNEL DELETION (ISSUE 1)
                const voiceChannel = collab.voiceChannelId ? guild.channels.cache.get(collab.voiceChannelId) : null;
                const textChannel = guild.channels.cache.get(collab.channelId);

                await voiceChannel?.delete().catch(() => {});
                await textChannel?.delete().catch(() => {});

                // Fetch fresh collab data from DB after saving owner video URL (Consistency)
                const freshCollab = CollabService.getCollab(collabId);

                const dmEmbed = new EmbedBuilder()
                    .setTitle('🎥 Video Submission')
                    .setDescription(`The collaboration **${freshCollab.title}** has ended.\n\nDid you upload a video for your participation?`)
                    .setColor(config.BRANDING.COLOR);

                const dmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`partvid_yes_${collabId}`).setLabel('YES').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`partvid_no_${collabId}`).setLabel('NO').setStyle(ButtonStyle.Danger)
                );

                for (const id of members) {
                    if (id === freshCollab.ownerId) continue;
                    try {
                        const target = await guild.client.users.fetch(id).catch(() => null);
                        if (target) {
                            await target.send({ embeds: [dmEmbed], components: [dmRow] }).catch(() => null);
                        }
                    } catch (dmErr) {
                        console.error(`[END COLLAB] DM Failed for user ${id}:`, dmErr);
                    }
                }

                await ApprovalService.sendApprovalRequest(guild, collabId);
                await interaction.editReply('✅ Collab successfully submitted for admin approval.');

            } catch (err) {
                console.error("END COLLAB MODAL CRASH:", err);
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply('❌ End collab failed due to an internal error.').catch(() => {});
                } else {
                    await interaction.reply({ content: '❌ End collab failed due to an internal error.', flags: 64 }).catch(() => {});
                }
            }
            return;
        }

        if (customId.startsWith('partvidmodal_')) {
            await interaction.deferReply({ flags: 64 });
            const collabId = customId.split('_')[1];

            if (!collabId || collabId === "partvidmodal") {
                console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                return interaction.editReply('❌ Invalid session. Please restart collab process.');
            }

            const url = fields.getTextInputValue('url');
            
            const collab = CollabService.getCollab(collabId);
            if (!collab || ['FINALIZED', 'FORCE_CLOSED'].includes(collab.status)) {
                return interaction.editReply('❌ This collab has already ended.');
            }

            // Check if user was a participant (ISSUE 3)
            const members = CollabService.getMembers(collabId);
            if (!members.includes(user.id)) {
                return interaction.editReply('❌ You were not a participant in this collab.');
            }

            CollabService.addParticipantVideo(collabId, user.id, url);
            
            // Update the original DM message to reflect submission
            if (interaction.message) {
                await interaction.message.edit({ content: '✅ Video link submitted!', components: [], embeds: [] }).catch(() => {});
            }
            
            await interaction.editReply('✅ Link submitted!');
            return;
        }

        if (customId.startsWith('admin_reject_modal_')) {
            await interaction.deferReply({ flags: 64 });
            const collabId = customId.split('_')[3];

            if (!collabId || collabId === "reject") {
                console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                return interaction.editReply('❌ Invalid session. Please restart collab process.');
            }
            const reason = fields.getTextInputValue('reason');
            const collab = CollabService.getCollab(collabId);
            const members = CollabService.getMembers(collabId);

            // Notify and Cleanup Users
            for (const id of members) {
                UserService.clearCollabState(id);
                const target = await guild.members.fetch(id).catch(() => null);
                if (target) {
                    await RoleService.syncCollabRoles(target, false);
                    try {
                        await target.send(`❌ Your collab **${collab.title}** was rejected. Reason: ${reason}`);
                    } catch (err) {}
                }
            }

            CollabService.updateStatus(collabId, 'FINALIZED');
            await interaction.editReply('❌ Rejected.');

            // FINAL STEP: Delete approval log message (SAFE FIX)
            try {
                if (interaction.message) {
                    await interaction.message.delete();
                } else {
                    // Fallback for modal context if interaction.message is missing
                    const logChannel = guild.channels.cache.get(config.CHANNELS.LOGS);
                    if (logChannel) {
                        const messages = await logChannel.messages.fetch({ limit: 50 });
                        const approvalMsg = messages.find(m => m.embeds[0]?.title?.includes('Collab Approval Required') && m.embeds[0]?.fields.some(f => f.value.includes(collab.title)));
                        if (approvalMsg) await approvalMsg.delete().catch(() => {});
                    }
                }
            } catch (err) {
                console.error("[COLLAB LOG] Failed to delete approval message:", err);
            }
            return;
        }

        if (customId === 'timeout_modal') {
            try {
                console.log("[TIMEOUT TRACE] STEP 6 - Modal submitted");
                await interaction.deferReply({ flags: 64 });
                const data = timeoutCache.get(user.id);
                if (!data) return interaction.editReply('❌ Timeout session expired.');

                const reason = fields.getTextInputValue('reason');
                const target = await guild.members.fetch(data.targetId).catch(() => null);

                if (!target) return interaction.editReply('❌ Target member not found.');

                // Check bot's own permissions and hierarchy
                const botMember = await guild.members.fetchMe();
                if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    return interaction.editReply('❌ Bot missing "Moderate Members" permission.');
                }
                if (botMember.roles.highest.position <= target.roles.highest.position) {
                    return interaction.editReply('❌ Bot role must be above the target user in the hierarchy.');
                }

                console.log("[TIMEOUT TRACE] STEP 7 - Applying timeout");
                // Apply Timeout
                await target.timeout(data.ms, reason);
                console.log("[TIMEOUT TRACE] STEP 8 - Timeout applied successfully");

                // Send DM
                console.log("[TIMEOUT TRACE] STEP 9 - Sending DM");
                const dmEmbed = new EmbedBuilder()
                    .setTitle('⚠️ You have received a timeout in CollabHub')
                    .addFields(
                        { name: '⏳ Duration', value: data.durationStr, inline: true },
                        { name: '📝 Reason', value: reason }
                    )
                    .setColor(0xFF0000)
                    .setTimestamp();

                await target.send({ embeds: [dmEmbed] })
                    .then(() => console.log("[TIMEOUT TRACE] STEP 10 - DM sent"))
                    .catch(() => console.log("[TIMEOUT TRACE] STEP 10 - DM failed"));

                // Send Log
                console.log("[TIMEOUT TRACE] STEP 11 - Sending log embed");
                const logChannel = guild.channels.cache.get(config.CHANNELS.TIMEOUT_LOGS);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('🚫 User Timed Out')
                        .addFields(
                            { name: '👤 Target', value: `<@${target.id}> (${target.id})`, inline: true },
                            { name: '🛡️ Moderator', value: `<@${user.id}>`, inline: true },
                            { name: '⏳ Duration', value: data.durationStr, inline: true },
                            { name: '📝 Reason', value: reason }
                        )
                        .setColor(0xFFA500)
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                    console.log("[TIMEOUT TRACE] STEP 12 - Log sent successfully");
                }

                await interaction.editReply(`✅ Successfully timed out <@${target.id}> for ${data.durationStr}.`);
                timeoutCache.delete(user.id);

            } catch (err) {
                console.error("[TIMEOUT ERROR]", err);
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply('❌ Failed to apply timeout. Check bot permissions.');
                } else {
                    await interaction.reply({ content: '❌ Failed to apply timeout. Check bot permissions.', flags: 64 });
                }
            }
        }
    }

    static async handleSelect(interaction) {
        try {
            const { customId, values, user } = interaction;
            
            // RATING SYSTEM ROUTING
            if (customId.startsWith('rate_')) {
                const [, collabId, participantId] = customId.split('_');
                
                if (!collabId || collabId === "rate") {
                    console.log("[CRITICAL] INVALID COLLAB ID:", customId);
                    return interaction.reply({
                        content: "❌ Invalid session. Please restart collab process.",
                        flags: 64
                    });
                }

                console.log("[TRACE] STEP 3 RATING SUBMITTED - collabId =", collabId, "participantId =", participantId);

                const cacheKey = `${user.id}_${collabId}`;
                const ratings = ratingCache.get(cacheKey) || {};
                ratings[participantId] = parseInt(values[0]);
                ratingCache.set(cacheKey, ratings);
                
                const members = CollabService.getMembers(collabId).filter(id => id !== user.id);
                const ratedCount = Object.keys(ratings).length;
                
                return await interaction.update({ 
                    content: `### 🌟 Step 1: Rate Participants\nProgress: **${ratedCount}/${members.length}** participants rated.\n\n✅ Updated rating for <@${participantId}>.`,
                    components: interaction.message.components 
                });
            }

            // COLLAB CREATION FLOW (FALLBACK)
            const state = creationCache.get(user.id) || {};
            let handled = false;

            if (customId === 'setup_lang') { state.language = values[0]; handled = true; }
            if (customId === 'setup_type') { state.contentType = values[0]; handled = true; }
            if (customId === 'setup_rank') { state.requiredRank = values[0]; handled = true; }
            if (customId === 'setup_devices') { state.devices = values; handled = true; }

            if (handled) {
                creationCache.set(user.id, state);
                return await interaction.deferUpdate();
            }

            console.log(`[INTERACTION DEBUG] Unhandled select menu: ${customId}`);

        } catch (error) {
            console.error('[handleSelect Error]:', error);
        }
    }

    static async handleCommand(interaction) {
        const { commandName, options, guild, member, user } = interaction;

        if (commandName === 'collab-stats') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only.', flags: 64 });
            await interaction.deferReply({ flags: 64 });
            const targetUser = options.getUser('user');
            const stats = UserService.getUser(targetUser.id);
            const averageRating = UserService.getAverageRating(targetUser.id);
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            const currentRole = targetMember ? RoleService.getMemberRank(targetMember) : 'Unknown';

            const embed = new EmbedBuilder()
                .setTitle(`📊 Collab Stats: ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: '👤 User', value: `<@${targetUser.id}>`, inline: true },
                    { name: '🏅 Current Role', value: currentRole, inline: true },
                    { name: '🎬 Total Collabs', value: String(stats.totalCompletedCollabs), inline: true },
                    { name: '⭐ Average Rating', value: `${averageRating} / 5.0`, inline: true },
                    { name: '📈 Total Ratings', value: String(stats.ratingCount), inline: true }
                )
                .setColor(config.BRANDING.COLOR);

            // Add Application Info if exists
            if (stats.name) {
                embed.addFields(
                    { name: '\u200B', value: '📝 **Creator Profile**' },
                    { name: '📌 Name', value: stats.name, inline: true },
                    { name: '🌍 Languages', value: stats.languages, inline: true },
                    { name: '🎮 Content Type', value: stats.contentType, inline: true },
                    { name: '📺 Channel', value: stats.channelLink },
                    { name: '🎥 Example Video', value: stats.exampleVideo }
                );
            }

            return await interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'edit-rating') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only.', flags: 64 });
            await interaction.deferReply({ flags: 64 });
            const targetUser = options.getUser('user');
            const collabId = options.getString('collab-id');
            const newRating = options.getInteger('rating');

            const oldRating = UserService.updateRating(targetUser.id, collabId, newRating);
            
            if (oldRating === null) {
                return interaction.editReply('❌ No existing rating found for this user in that collab.');
            }

            // Log change in collab logs channel
            const logChannel = guild.channels.cache.get(config.CHANNELS.LOGS);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Rating Edited')
                    .setColor(0xFFA500)
                    .addFields(
                        { name: '👤 User', value: `<@${targetUser.id}>`, inline: true },
                        { name: '🎬 Collab ID', value: collabId, inline: true },
                        { name: '⭐ Old Rating', value: `${oldRating}`, inline: true },
                        { name: '🌟 New Rating', value: `${newRating}`, inline: true },
                        { name: '🛡️ Admin', value: `<@${user.id}>`, inline: true }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }

            // Re-sync roles for the target user based on updated stats
            const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (targetMember) {
                const stats = UserService.getUser(targetUser.id);
                const avg = UserService.getAverageRating(targetUser.id);
                await RoleService.updateCreatorRank(targetMember, stats.totalCompletedCollabs, parseFloat(avg));
            }

            return await interaction.editReply(`✅ Successfully updated rating for <@${targetUser.id}> to ${newRating} stars.`);
        }

        if (commandName === 'collab-list') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only.', flags: 64 });
            await interaction.deferReply({ flags: 64 });
            const collabs = db.prepare("SELECT * FROM collabs WHERE status NOT IN (?, ?)").all('FINALIZED', 'FORCE_CLOSED');
            if (collabs.length === 0) return interaction.editReply('No active collabs.');

            const embed = new EmbedBuilder().setTitle('📋 Active Collabs').setColor(config.BRANDING.COLOR);
            collabs.forEach(c => {
                embed.addFields({ name: `${c.title} (${c.collabId})`, value: `Owner: <@${c.ownerId}>\nStatus: ${c.status}\nMembers: ${c.currentMembers}/${c.maxMembers}` });
            });
            return await interaction.editReply({ embeds: [embed] });
        }

        if (commandName === 'force-end-collab') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only.', flags: 64 });
            await interaction.deferReply({ flags: 64 });
            const id = options.getString('collab-id');
            const collab = CollabService.getCollab(id);
            if (!collab) return interaction.editReply('Not found.');

            const members = CollabService.getMembers(id);
            for (const uid of members) {
                UserService.clearCollabState(uid);
                const m = await guild.members.fetch(uid).catch(() => null);
                if (m) await RoleService.syncCollabRoles(m, false);
            }
            CollabService.updateStatus(id, 'FORCE_CLOSED');
            const channel = guild.channels.cache.get(collab.channelId);
            if (channel) await channel.delete().catch(() => {});
            return await interaction.editReply('✅ Force closed.');
        }

        if (commandName === 'timeout') {
            console.log("[TIMEOUT TRACE] STEP 1 - Command received");
            const isOwner = user.id === guild.ownerId;
            const isAdmin = member.roles.cache.has(config.ROLES.ADMIN);
            const isModerator = member.roles.cache.has(config.ROLES.MODERATOR);

            if (!isOwner && !isAdmin && !isModerator) {
                return interaction.reply({ content: '❌ Admin or Moderator only.', flags: 64 });
            }
            console.log("[TIMEOUT TRACE] STEP 2 - Permission check passed");

            const target = options.getMember('target');
            const durationStr = options.getString('duration');

            if (!target) return interaction.reply({ content: '❌ Target member not found.', flags: 64 });
            console.log(`[TIMEOUT TRACE] STEP 3 - Target user found: ${target.id}`);

            if (target.id === user.id) return interaction.reply({ content: '❌ You cannot timeout yourself.', flags: 64 });
            if (target.id === guild.client.user.id) return interaction.reply({ content: '❌ You cannot timeout the bot.', flags: 64 });
            if (target.id === guild.ownerId) return interaction.reply({ content: '❌ You cannot timeout the server owner.', flags: 64 });
            
            // Role ID check for target instead of Administrator permission
            if (target.roles.cache.has(config.ROLES.ADMIN)) return interaction.reply({ content: '❌ You cannot timeout an administrator.', flags: 64 });
            
            if (member.roles.highest.position <= target.roles.highest.position && !isOwner) return interaction.reply({ content: '❌ You cannot timeout someone with a higher or equal role.', flags: 64 });

            const ms = this.parseDuration(durationStr);
            if (!ms || ms < 5000 || ms > 2419200000) { // Discord max is 28 days
                return interaction.reply({ content: '❌ Invalid duration. Use format: 30s, 15m, 2h, 1d (Min 5s, Max 28d).', flags: 64 });
            }
            console.log(`[TIMEOUT TRACE] STEP 4 - Duration parsed: ${durationStr}`);

            timeoutCache.set(user.id, { targetId: target.id, ms, durationStr });

            const modal = new ModalBuilder()
                .setCustomId('timeout_modal')
                .setTitle('Timeout Reason');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Reason for Timeout')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMaxLength(500)
                )
            );

            console.log("[TIMEOUT TRACE] STEP 5 - Opening reason modal");
            await interaction.showModal(modal);
        }

        if (commandName === 'music') {
            if (!member.voice.channel) return interaction.reply({ content: '❌ You must be in a voice channel.', flags: 64 });
            const embed = new EmbedBuilder()
                .setTitle('🎵 Music Control Panel')
                .setDescription('Use the buttons below to control the music in your channel.')
                .setColor(0x5865F2);
            return interaction.reply({ embeds: [embed], components: getMusicControlButtons(member.voice.channel.id) });
        }

        if (commandName === 'staff-controls') {
            const isStaff = member.roles.cache.has(config.ROLES.OWNER_ROLE) || member.roles.cache.has(config.ROLES.ADMIN);
            if (!isStaff) return interaction.reply({ content: '❌ Staff only.', flags: 64 });
            if (!member.voice.channel) return interaction.reply({ content: '❌ You must be in a voice channel.', flags: 64 });
            
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Staff Voice Controls')
                .setDescription(`Manage all users in **${member.voice.channel.name}**.`)
                .setColor(0xED4245);
            return interaction.reply({ embeds: [embed], components: [getStaffButtons(member.voice.channel.id)] });
        }

        if (commandName === 'voice-panel') {
            if (!member.voice.channel) return interaction.reply({ content: '❌ You must be in a voice channel.', flags: 64 });
            return interaction.reply({ embeds: [getVoicePanelEmbed()], components: getVoicePanelButtons() });
        }
    }

    static parseDuration(str) {
        const match = str.match(/^(\d+)([smhd])$/);
        if (!match) return null;
        const val = parseInt(match[1]);
        const unit = match[2];
        const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
        return val * multipliers[unit];
    }
}

export default InteractionHandler;