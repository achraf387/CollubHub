import config from '../config/config.js';

class RoleService {
    static async syncCollabRoles(member, inCollab) {
        try {
            // STEP 4 & 6: SAFE ROLE HANDLING + LOGGING
            if (!member.manageable) {
                console.log("[ROLE RESET] Cannot update role for (Not Manageable):", member.id);
                return;
            }

            console.log(`[ROLE RESET] Updating user: ${member.id} (In Collab: ${inCollab})`);

            if (inCollab) {
                await member.roles.add(config.ROLES.IN_COLLAB).catch((err) => console.error(`[ROLE ERROR] Add IN_COLLAB failed for ${member.id}:`, err));
                await member.roles.remove(config.ROLES.LOOKING_FOR_COLLAB).catch((err) => console.error(`[ROLE ERROR] Remove LOOKING_FOR failed for ${member.id}:`, err));
            } else {
                await member.roles.remove(config.ROLES.IN_COLLAB).catch((err) => console.error(`[ROLE ERROR] Remove IN_COLLAB failed for ${member.id}:`, err));
                await member.roles.add(config.ROLES.LOOKING_FOR_COLLAB).catch((err) => console.error(`[ROLE ERROR] Add LOOKING_FOR failed for ${member.id}:`, err));
            }
        } catch (error) {
            console.error(`[RoleService] Error syncing roles for ${member.id}:`, error);
        }
    }

    static async updateCreatorRank(member, completedCount, averageRating = 0) {
        try {
            // NEW RULE (ADD ONLY LOGIC, DO NOT REMOVE OLD)
            // ACTIVE CREATOR: collabs >= 3
            // TRUSTED CREATOR: collabs >= 10 AND averageRating >= 4.2

            if (completedCount >= 10 && averageRating >= 4.2) {
                await member.roles.add(config.ROLES.TRUSTED_CREATOR).catch(() => {});
                // DO NOT remove lower roles as per STEP 6
            }
            
            if (completedCount >= 3) {
                await member.roles.add(config.ROLES.ACTIVE_CREATOR).catch(() => {});
            }
        } catch (error) {
            console.error(`[RoleService] Error updating creator rank for ${member.id}:`, error);
        }
    }

    static getMemberRank(member) {
        if (member.roles.cache.has(config.ROLES.TRUSTED_CREATOR)) return 'Trusted Creator';
        if (member.roles.cache.has(config.ROLES.ACTIVE_CREATOR)) return 'Active Creator';
        return 'Member';
    }

    static getRankValue(rankName) {
        const values = {
            'Member': 1,
            'Active Creator': 2,
            'Trusted Creator': 3
        };
        return values[rankName] || 0;
    }

    static canChooseRank(memberRank, targetRank) {
        return this.getRankValue(memberRank) >= this.getRankValue(targetRank);
    }
}

export default RoleService;
