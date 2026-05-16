import db from '../database/db.js';
import UserService from './UserService.js';
import RoleService from './RoleService.js';

class RecoveryService {
    static async selfHeal(guild, userId) {
        const user = UserService.getUser(userId);
        if (!user.currentCollabId) return;

        const collab = db.prepare('SELECT * FROM collabs WHERE collabId = ?').get(user.currentCollabId);
        
        // If collab missing or finalized/archived, clear user state
        if (!collab || ['FINALIZED', 'FORCE_CLOSED'].includes(collab.status)) {
            UserService.clearCollabState(userId);
            
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
                await RoleService.syncCollabRoles(member, false);
            }
        }
    }

    static async cleanupStaleCollabs(guild) {
        const activeCollabs = db.prepare("SELECT * FROM collabs WHERE status NOT IN (?, ?)").all('FINALIZED', 'FORCE_CLOSED');
        for (const collab of activeCollabs) {
            const channel = guild.channels.cache.get(collab.channelId);
            if (!channel && collab.status !== 'FINALIZED') {
                console.log(`[RECOVERY] Force closing stale collab: ${collab.collabId}`);
                db.prepare("UPDATE collabs SET status = ? WHERE collabId = ?").run('FORCE_CLOSED', collab.collabId);
                
                // Also cleanup roles for participants of stale collabs
                const members = db.prepare('SELECT userId FROM collab_members WHERE collabId = ?').all(collab.collabId).map(m => m.userId);
                for (const userId of members) {
                    UserService.clearCollabState(userId);
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        await RoleService.syncCollabRoles(member, false);
                    }
                }
            }
        }
    }
}

export default RecoveryService;
