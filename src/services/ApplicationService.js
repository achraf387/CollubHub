import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../database/db.js';
import config from '../config/config.js';

class ApplicationService {
    static createApplication(userId, data) {
        const stmt = db.prepare(`
            INSERT INTO applications (userId, name, languages, contentType, channelLink, exampleVideo, consistently, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
            ON CONFLICT(userId) DO UPDATE SET
                name = excluded.name,
                languages = excluded.languages,
                contentType = excluded.contentType,
                channelLink = excluded.channelLink,
                exampleVideo = excluded.exampleVideo,
                consistently = excluded.consistently,
                status = 'PENDING',
                createdAt = CURRENT_TIMESTAMP
        `);
        stmt.run(userId, data.name, data.languages, data.contentType, data.channelLink, data.exampleVideo, data.consistently);
    }

    static getApplication(userId) {
        return db.prepare('SELECT * FROM applications WHERE userId = ?').get(userId);
    }

    static updateApplicationMessage(userId, messageId) {
        db.prepare('UPDATE applications SET messageId = ? WHERE userId = ?').run(messageId, userId);
    }

    static async approveApplication(guild, userId, ownerId) {
        const application = this.getApplication(userId);
        if (!application) return { success: false, error: 'Application not found' };

        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return { success: false, error: 'Member not found in server' };

            // Update Roles
            await member.roles.remove(config.ROLES.VISITOR).catch(() => {});
            await member.roles.add([config.ROLES.MEMBER, config.ROLES.LOOKING_FOR_COLLAB]).catch(() => {});

            // Save to Profile (Users table)
            db.prepare(`
                UPDATE users SET 
                    name = ?, languages = ?, contentType = ?, 
                    channelLink = ?, exampleVideo = ?, consistently = ?
                WHERE userId = ?
            `).run(
                application.name, application.languages, application.contentType,
                application.channelLink, application.exampleVideo, application.consistently,
                userId
            );

            // Delete Log Message
            const logChannel = guild.channels.cache.get(config.CHANNELS.JOINING_LOGS);
            if (logChannel && application.messageId) {
                const msg = await logChannel.messages.fetch(application.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }

            // DM User
            const dmEmbed = new EmbedBuilder()
                .setTitle('✅ Application Approved!')
                .setDescription(`Welcome to CollabHub! Your application has been accepted.\n\nYou now have access to all creator channels and the collaboration system.`)
                .setColor(0x00FF00)
                .setTimestamp();

            await member.send({ embeds: [dmEmbed] }).catch(() => {});

            // Delete application record or update status
            db.prepare('DELETE FROM applications WHERE userId = ?').run(userId);

            return { success: true };
        } catch (error) {
            console.error('[ApplicationService] Approval Error:', error);
            return { success: false, error: 'Internal Error' };
        }
    }

    static async rejectApplication(guild, userId, reason) {
        const application = this.getApplication(userId);
        if (!application) return { success: false, error: 'Application not found' };

        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            
            // Delete Log Message
            const logChannel = guild.channels.cache.get(config.CHANNELS.JOINING_LOGS);
            if (logChannel && application.messageId) {
                const msg = await logChannel.messages.fetch(application.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }

            // DM User
            if (member) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('❌ Application Rejected')
                    .setDescription(`We regret to inform you that your application to join **${config.BRANDING.NAME}** has been rejected.`)
                    .addFields(
                        { name: '📝 Reason', value: reason },
                        { name: '🛡️ Appeal', value: `If you have any questions, you can open a ticket in <#${config.CHANNELS.TICKET}>.` }
                    )
                    .setColor(0xFF0000)
                    .setTimestamp();

                await member.send({ embeds: [dmEmbed] }).catch(() => {});
            }

            // Delete application record or update status
            db.prepare('DELETE FROM applications WHERE userId = ?').run(userId);

            return { success: true };
        } catch (error) {
            console.error('[ApplicationService] Rejection Error:', error);
            return { success: false, error: 'Internal Error' };
        }
    }

    static cleanupUserData(userId) {
        db.prepare('DELETE FROM applications WHERE userId = ?').run(userId);
        db.prepare(`
            UPDATE users SET 
                name = NULL, languages = NULL, contentType = NULL, 
                channelLink = NULL, exampleVideo = NULL, consistently = NULL 
            WHERE userId = ?
        `).run(userId);
    }

    static hasActiveApplication(userId) {
        const app = db.prepare('SELECT status FROM applications WHERE userId = ?').get(userId);
        return app && app.status === 'PENDING';
    }
}

export default ApplicationService;
