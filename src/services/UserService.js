import db from '../database/db.js';

class UserService {
    static getUser(userId) {
        let user = db.prepare('SELECT * FROM users WHERE userId = ?').get(userId);
        if (!user) {
            db.prepare('INSERT INTO users (userId) VALUES (?)').run(userId);
            user = { userId, currentCollabId: null, totalCompletedCollabs: 0, totalRatingPoints: 0, ratingCount: 0, averageRating: 0 };
        }
        
        // Step 3: Ensure no crash if null (Safety check)
        user.totalRatingPoints = user.totalRatingPoints || 0;
        user.ratingCount = user.ratingCount || 0;
        user.averageRating = user.averageRating || 0;

        return user;
    }

    static updateCurrentCollab(userId, collabId) {
        db.prepare('UPDATE users SET currentCollabId = ? WHERE userId = ?').run(collabId, userId);
    }

    static incrementCompletedCount(userId) {
        db.prepare('UPDATE users SET totalCompletedCollabs = totalCompletedCollabs + 1 WHERE userId = ?').run(userId);
    }

    static addRating(userId, collabId, rating) {
        return db.transaction(() => {
            const user = this.getUser(userId);
            const existing = db.prepare('SELECT rating FROM participant_ratings WHERE collabId = ? AND userId = ?').get(collabId, userId);
            
            if (existing) {
                return false; // Already rated
            }

            // Step 4: Recalculation logic
            const newTotalPoints = (user.totalRatingPoints || 0) + rating;
            const newCount = (user.ratingCount || 0) + 1;
            const newAverage = (newTotalPoints / newCount);

            db.prepare('INSERT INTO participant_ratings (collabId, userId, rating) VALUES (?, ?, ?)').run(collabId, userId, rating);
            db.prepare('UPDATE users SET totalRatingPoints = ?, ratingCount = ?, averageRating = ? WHERE userId = ?')
              .run(newTotalPoints, newCount, newAverage, userId);
            
            return true;
        })();
    }

    static updateRating(userId, collabId, newRating) {
        return db.transaction(() => {
            const user = this.getUser(userId);
            const oldRating = db.prepare('SELECT rating FROM participant_ratings WHERE collabId = ? AND userId = ?').get(collabId, userId);
            if (!oldRating) return null;

            db.prepare('UPDATE participant_ratings SET rating = ? WHERE collabId = ? AND userId = ?').run(newRating, collabId, userId);
            
            // Recalculate average after update
            const newTotalPoints = (user.totalRatingPoints || 0) - oldRating.rating + newRating;
            const newAverage = (newTotalPoints / user.ratingCount);

            db.prepare('UPDATE users SET totalRatingPoints = ?, averageRating = ? WHERE userId = ?')
              .run(newTotalPoints, newAverage, userId);
              
            return oldRating.rating;
        })();
    }

    static getAverageRating(userId) {
        const user = this.getUser(userId);
        if (!user || user.ratingCount === 0) return 0;
        return (user.totalRatingPoints / user.ratingCount).toFixed(1);
    }

    static clearCollabState(userId) {
        db.prepare('UPDATE users SET currentCollabId = NULL WHERE userId = ?').run(userId);
    }
}

export default UserService;
