import { PermissionFlagsBits } from 'discord.js';
import config from '../config/config.js';

class PermissionService {
    static getCreationOverwrites(guild, ownerId) {
        return [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: config.ROLES.IN_COLLAB, deny: [PermissionFlagsBits.ViewChannel] },
            { id: config.ROLES.LOOKING_FOR_COLLAB, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
            { id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];
    }

    static async makeChannelPrivate(channel, ownerId, participantIds) {
        // Remove all public overwrites
        const rolesToRemove = [
            config.ROLES.LOOKING_FOR_COLLAB,
            config.ROLES.IN_COLLAB,
            config.ROLES.MEMBER, 
            config.ROLES.ACTIVE_CREATOR, 
            config.ROLES.TRUSTED_CREATOR
        ];

        for (const roleId of rolesToRemove) {
            await channel.permissionOverwrites.delete(roleId).catch(() => {});
        }

        // Grant explicit access to owner and participants
        const users = [ownerId, ...participantIds];
        for (const userId of users) {
            await channel.permissionOverwrites.create(userId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            }).catch(() => {});
        }
    }
}

export default PermissionService;
