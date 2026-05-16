import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../database/db.js';
import config from '../config/config.js';

class CollabService {
    static createCollab(data) {
        const insert = db.prepare(`
            INSERT INTO collabs (collabId, ownerId, title, description, language, contentType, requiredRank, allowedDevices, maxMembers, scheduledTime, channelId, status)
            VALUES (@collabId, @ownerId, @title, @description, @language, @contentType, @requiredRank, @allowedDevices, @maxMembers, @scheduledTime, @channelId, @status)
        `);
        const insertMember = db.prepare(`INSERT INTO collab_members (collabId, userId) VALUES (?, ?)`);
        
        const transaction = (collabData) => {
            insert.run({ ...collabData, status: 'LOOKING' });
            insertMember.run(collabData.collabId, collabData.ownerId);
            db.prepare('UPDATE users SET currentCollabId = ? WHERE userId = ?').run(collabData.collabId, collabData.ownerId);
        };
        db.transaction(transaction)(data);
    }

    static getCollab(id) {
        return db.prepare('SELECT * FROM collabs WHERE collabId = ?').get(id);
    }

    static getMembers(collabId) {
        return db.prepare('SELECT userId FROM collab_members WHERE collabId = ?').all(collabId).map(m => m.userId);
    }

    static addMember(collabId, userId) {
        const transaction = db.transaction(() => {
            db.prepare('INSERT INTO collab_members (collabId, userId) VALUES (?, ?)').run(collabId, userId);
            db.prepare('UPDATE collabs SET currentMembers = currentMembers + 1 WHERE collabId = ?').run(collabId);
            db.prepare('UPDATE users SET currentCollabId = ? WHERE userId = ?').run(collabId, userId);
        });
        transaction();
    }

    static updateStatus(collabId, status) {
        db.prepare('UPDATE collabs SET status = ? WHERE collabId = ?').run(status, collabId);
    }

    static updateVoiceChannel(collabId, voiceChannelId) {
        db.prepare('UPDATE collabs SET voiceChannelId = ? WHERE collabId = ?').run(voiceChannelId, collabId);
    }

    static setOwnerVideo(collabId, url) {
        db.prepare('UPDATE collabs SET ownerVideoUrl = ?, status = ? WHERE collabId = ?').run(url, 'APPROVAL', collabId);
    }

    static addParticipantVideo(collabId, userId, url) {
        db.prepare(`
            INSERT INTO participant_videos (collabId, userId, videoUrl) 
            VALUES (?, ?, ?)
            ON CONFLICT(collabId, userId) DO UPDATE SET 
                videoUrl = COALESCE(excluded.videoUrl, videoUrl)
        `).run(collabId, userId, url);
    }

    static getParticipantVideos(collabId) {
        return db.prepare('SELECT * FROM participant_videos WHERE collabId = ?').all(collabId);
    }

    static buildCollabEmbed(collab) {
        const devices = collab.allowedDevices ? JSON.parse(collab.allowedDevices).join(', ') : "None";
        
        // Dynamic Status Check (ISSUE 1)
        let displayStatus = collab.status || "UNKNOWN";
        if (['LOOKING', 'FULL'].includes(displayStatus)) {
            displayStatus = collab.currentMembers >= collab.maxMembers ? 'FULL' : 'LOOKING';
        }

        const embed = new EmbedBuilder()
            .setTitle(`🎬 ${collab.title || "Untitled"}`)
            .setDescription(collab.description || "No description")
            .addFields(
                { name: '👑 Owner', value: collab.ownerId ? `<@${collab.ownerId}>` : "Unknown", inline: true },
                { name: '👥 Members', value: `${collab.currentMembers || 0} / ${collab.maxMembers || 0}`, inline: true },
                { name: '🌍 Language', value: collab.language || "Not set", inline: true },
                { name: '🎮 Type', value: collab.contentType || "Not set", inline: true },
                { name: '🏅 Rank', value: collab.requiredRank || "Member", inline: true },
                { name: '🖥️ Devices', value: devices, inline: true },
                { name: '📅 Schedule', value: collab.scheduledTime || "TBD", inline: true },
                { name: '📊 Status', value: `\`${displayStatus}\``, inline: true }
            )
            .setColor(displayStatus === 'FULL' ? 0xFF0000 : config.BRANDING.COLOR)
            .setTimestamp();
        
        return embed;
    }

    static getButtons(collabId, status, collab = null) {
        let currentStatus = status;
        
        // Dynamic status check for buttons if collab object provided (ISSUE 1)
        if (collab && ['LOOKING', 'FULL'].includes(currentStatus)) {
            currentStatus = collab.currentMembers >= collab.maxMembers ? 'FULL' : 'LOOKING';
        }

        if (['ENDING', 'APPROVAL', 'FINALIZED'].includes(currentStatus)) return [];
        
        const row = new ActionRowBuilder();
        if (currentStatus === 'LOOKING' || currentStatus === 'ACTIVE') {
            row.addComponents(
                new ButtonBuilder().setCustomId(`join_${collabId}`).setLabel('JOIN COLLAB').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`end_${collabId}`).setLabel('END COLLAB').setStyle(ButtonStyle.Danger)
            );
        } else if (currentStatus === 'FULL') {
            row.addComponents(
                new ButtonBuilder().setCustomId(`end_${collabId}`).setLabel('END COLLAB').setStyle(ButtonStyle.Danger)
            );
        }
        return row.components.length > 0 ? [row] : [];
    }
}

export default CollabService;
