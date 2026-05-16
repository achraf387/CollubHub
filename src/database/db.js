import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '../../collab_nexus_v4.db'));

// Initialize Schema
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        currentCollabId TEXT,
        totalCompletedCollabs INTEGER DEFAULT 0,
        totalRatingPoints INTEGER DEFAULT 0,
        ratingCount INTEGER DEFAULT 0,
        averageRating REAL DEFAULT 0
    );

    -- SAFE MIGRATION: Add missing columns if table already exists
    -- We use a TRY-CATCH approach via JavaScript to handle SQLite's lack of "IF NOT EXISTS" for ADD COLUMN
`);

// Migration: Add columns if they don't exist
const columns = [
    { name: 'totalRatingPoints', type: 'INTEGER DEFAULT 0' },
    { name: 'ratingCount', type: 'INTEGER DEFAULT 0' },
    { name: 'averageRating', type: 'REAL DEFAULT 0' },
    { name: 'name', type: 'TEXT' },
    { name: 'languages', type: 'TEXT' },
    { name: 'contentType', type: 'TEXT' },
    { name: 'channelLink', type: 'TEXT' },
    { name: 'exampleVideo', type: 'TEXT' },
    { name: 'consistently', type: 'TEXT' }
];

for (const col of columns) {
    try {
        db.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
        console.log(`[DB] Added missing column: ${col.name}`);
    } catch (err) {
        // Ignore error if column already exists
        if (!err.message.includes('duplicate column name')) {
            console.error(`[DB] Migration error for ${col.name}:`, err.message);
        }
    }
}

db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
        userId TEXT PRIMARY KEY,
        name TEXT,
        languages TEXT,
        contentType TEXT,
        channelLink TEXT,
        exampleVideo TEXT,
        consistently TEXT,
        messageId TEXT,
        status TEXT DEFAULT 'PENDING',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS participant_ratings (
        collabId TEXT,
        userId TEXT,
        rating INTEGER,
        PRIMARY KEY (collabId, userId),
        FOREIGN KEY (collabId) REFERENCES collabs(collabId) ON DELETE CASCADE
    );

    -- Ensure unique constraint on ratings (ISSUE 1)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_ratings_unique ON participant_ratings (collabId, userId);

    CREATE TABLE IF NOT EXISTS collabs (
        collabId TEXT PRIMARY KEY,
        ownerId TEXT,
        title TEXT,
        description TEXT,
        language TEXT,
        contentType TEXT,
        requiredRank TEXT,
        allowedDevices TEXT, -- JSON array
        maxMembers INTEGER,
        currentMembers INTEGER DEFAULT 1,
        scheduledTime TEXT,
        status TEXT DEFAULT 'LOOKING', -- LOOKING, ACTIVE, FULL, ENDING, APPROVAL, FINALIZED
        channelId TEXT,
        voiceChannelId TEXT,
        resultMessageId TEXT,
        ownerVideoUrl TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collab_members (
        collabId TEXT,
        userId TEXT,
        joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collabId, userId),
        FOREIGN KEY (collabId) REFERENCES collabs(collabId) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS participant_videos (
        collabId TEXT,
        userId TEXT,
        videoUrl TEXT,
        submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collabId, userId),
        FOREIGN KEY (collabId) REFERENCES collabs(collabId) ON DELETE CASCADE
    );
`);

export default db;
