import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import config from '../config/config.js';
import CollabService from './CollabService.js';
import UserService from './UserService.js';
import RoleService from './RoleService.js';
import db from '../database/db.js';

class ApprovalService {
    static async sendApprovalRequest(guild, collabId) {
        try {
            // STEP 2: FORCE FETCH FROM DB BEFORE LOGS
            const collab = CollabService.getCollab(collabId);
            if (!collab) {
                console.error("[LOG ERROR] Collab not found in DB for logs:", collabId);
                return;
            }

            // STEP 4: DEBUG LOG
            console.log("[DEBUG VIDEO URL] Collab ID:", collabId, "URL:", collab.ownerVideoUrl);

            const logChannel = guild.channels.cache.get(config.CHANNELS.LOGS);
            if (!logChannel) {
                console.log("[ERROR] LOG CHANNEL ID IS MISSING OR INACCESSIBLE:", config.CHANNELS.LOGS);
                return;
            }

            const members = CollabService.getMembers(collabId);
            const submissions = CollabService.getParticipantVideos(collabId);

            const embed = new EmbedBuilder()
                .setTitle('🔍 Collab Approval Required')
                .setColor(0xFFFF00);

            // Fetch ratings for this collab
            const ratings = db.prepare('SELECT userId, rating FROM participant_ratings WHERE collabId = ?').all(collabId);
            const ratingMap = Object.fromEntries(ratings.map(r => [r.userId, r.rating]));

            const participantRatings = members
                .filter(id => id !== collab.ownerId)
                .map(id => {
                    const stars = '⭐'.repeat(ratingMap[id] || 0);
                    return `<@${id}>: ${stars}`;
                })
                .join('\n');

            // STEP 3: FIX EMBED FIELD MAPPING & STEP 5: VALIDATION RULE
            const videoDisplay = (collab.ownerVideoUrl && collab.ownerVideoUrl.startsWith("http")) 
                ? `[Click to Watch](${collab.ownerVideoUrl})` 
                : "No video submitted";

            let fields = [
                { name: '📌 Title', value: collab.title ? String(collab.title) : "Not provided", inline: true },
                { name: '👑 Owner', value: collab.ownerId ? `<@${collab.ownerId}>` : "Unknown Owner", inline: true },
                { 
                    name: '🎥 Main Video', 
                    value: videoDisplay
                },
                { name: '🤝 Participants & Ratings', value: participantRatings || "No participants" }
            ];

            if (submissions && submissions.length > 0) {
                fields.push({ 
                    name: '🎥 Participant Videos', 
                    value: submissions.map(s => `<@${s.userId}>: ${s.videoUrl ? String(s.videoUrl) : "Declined"}`).join('\n') 
                });
            }

            // REQUIRED EXTRA SAFETY: Filter invalid fields
            fields = fields.filter(field => 
                field && 
                typeof field.name === "string" && 
                typeof field.value === "string" &&
                field.value.trim() !== ""
            );

            embed.addFields(fields);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`admin_approve_${collab.collabId}`).setLabel('APPROVE').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`admin_reject_${collab.collabId}`).setLabel('REJECT').setStyle(ButtonStyle.Danger)
            );

            await logChannel.send({ embeds: [embed], components: [row] });
            console.log("[SUCCESS] Collab approval log sent to channel:", config.CHANNELS.LOGS);
        } catch (err) {
            console.error("[LOG ERROR] Failed to send collab approval log:", err);
        }
    }

    static async rejectCollab(guild, collabId) {
        try {
            const collab = CollabService.getCollab(collabId);
            if (!collab) return;

            const owner = await guild.members.fetch(collab.ownerId).catch(() => null);
            if (owner) {
                try {
                    await owner.send(`❌ Your collab **${collab.title}** has been rejected by an administrator.`);
                } catch (err) {
                    console.error(`[ApprovalService] DM Failed for user ${collab.ownerId}:`, err);
                }
            }

            CollabService.updateStatus(collabId, 'REJECTED');
            console.log(`[SUCCESS] Collab ${collabId} rejected.`);
        } catch (err) {
            console.error("[REJECTION ERROR] Failed to reject collab:", err);
        }
    }

    static async finalizeCollab(guild, collabId) {
        try {
            const collab = CollabService.getCollab(collabId);
            const members = CollabService.getMembers(collabId);
            const submissions = CollabService.getParticipantVideos(collabId);

            // 1. Post Results
            const resultsChannel = guild.channels.cache.get(config.CHANNELS.RESULTS);
            if (resultsChannel) {
                const resEmbed = new EmbedBuilder()
                    .setTitle(`🎬 Collab Completed: ${collab.title ? String(collab.title) : "Untitled"}`)
                    .setColor(0x00FF00);

                // Fetch ratings for this collab
                const ratings = db.prepare('SELECT userId, rating FROM participant_ratings WHERE collabId = ?').all(collabId);
                const ratingMap = Object.fromEntries(ratings.map(r => [r.userId, r.rating]));

                const participantList = members
                    .filter(id => id !== collab.ownerId)
                    .map(id => {
                        const stars = '⭐'.repeat(ratingMap[id] || 0);
                        return `<@${id}> ${stars}`;
                    })
                    .join('\n');

                let resFields = [
                    { name: '👑 Host', value: collab.ownerId ? `<@${collab.ownerId}>` : "Unknown Owner", inline: true },
                    { name: '🤝 Participants', value: participantList || "No participants", inline: true },
                    { name: '🎬 Host Video', value: collab.ownerVideoUrl ? String(collab.ownerVideoUrl) : "No video provided" }
                ];

                if (submissions && submissions.length > 0) {
                    resFields.push({ 
                        name: '🎥 Participant Videos', 
                        value: submissions.map(s => `<@${s.userId}>: ${s.videoUrl ? String(s.videoUrl) : "No link"}`).join('\n') 
                    });
                }

                // Safety filter for results embed
                resFields = resFields.filter(f => f && typeof f.name === "string" && typeof f.value === "string" && f.value.trim() !== "");
                resEmbed.addFields(resFields);

                await resultsChannel.send({ embeds: [resEmbed] });
                await resultsChannel.send(config.BRANDING.SEPARATOR);
                console.log("[SUCCESS] Collab results posted to channel:", config.CHANNELS.RESULTS);
            }

            // 2. Cleanup Roles & States
            for (const userId of members) {
                UserService.incrementCompletedCount(userId);
                UserService.clearCollabState(userId);
                
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await RoleService.syncCollabRoles(member, false);
                    const stats = UserService.getUser(userId);
                    const averageRating = UserService.getAverageRating(userId);
                    await RoleService.updateCreatorRank(member, stats.totalCompletedCollabs, parseFloat(averageRating));
                    try {
                        await member.send(`✅ Your collab **${collab.title}** has been approved and finalized!`);
                    } catch (err) {
                        console.error(`[ApprovalService] DM Failed for user ${userId}:`, err);
                    }
                }
            }

            CollabService.updateStatus(collabId, 'FINALIZED');
        } catch (err) {
            console.error("[FINALIZATION ERROR] Failed to finalize collab:", err);
        }
    }
}

export default ApprovalService;
