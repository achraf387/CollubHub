import "dotenv/config";
import { Client, GatewayIntentBits, Partials, REST, Routes, ApplicationCommandOptionType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import config from './src/config/config.js';
import InteractionHandler from './src/interactions/InteractionHandler.js';
import RecoveryService from './src/services/RecoveryService.js';
import ApplicationService from './src/services/ApplicationService.js';
import { initMusicSystem, getMusicControlButtons } from './src/modules/musicSystem.js';
import { initStaffControls, getStaffButtons } from './src/modules/staffControls.js';
import { initVoicePanel, getVoicePanelEmbed, getVoicePanelButtons } from './src/modules/voicePanel.js';
import { initVoiceSystem } from './src/modules/voiceSystem.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.once('ready', async () => {
    console.log(`[SYSTEM] Logged in as ${client.user.tag}`);
    await registerCommands();
    await setupPanel();
    await setupApplyPanel();
    initMusicSystem(client);
    initStaffControls(client);
    initVoicePanel(client);
    initVoiceSystem(client);
    
    // Log System Rebuild
    const logChannel = client.channels.cache.get('1502767041793360115');
    if (logChannel) {
        const rebuildEmbed = new EmbedBuilder()
            .setTitle('⚙️ System Rebuild Started')
            .setDescription('✅ **Music System Rebuilt**\n✅ **Staff Controls Rebuilt**\n✅ **Voice Panel Rebuilt**\n❌ **Auto-Voice Generation Disabled**')
            .setColor(0x5865F2)
            .setTimestamp();
        await logChannel.send({ embeds: [rebuildEmbed] }).catch(() => {});
    }
    
    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (guild) await RecoveryService.cleanupStaleCollabs(guild);
});

async function setupApplyPanel() {
    const channel = client.channels.cache.get(config.CHANNELS.APPLY);
    if (!channel) return console.error("[SYSTEM] Apply channel not found!");

    const embed = new EmbedBuilder()
        .setTitle('📝 Creator Application System')
        .setDescription(`Welcome to **${config.BRANDING.NAME}**! To gain access to our collaboration systems, you must first apply and be verified.\n\n**Requirements:**\n- Only serious creators should apply.\n- All information provided must be accurate.\n- Accepted members gain full access to creator channels.\n- Spam or fake applications will be rejected immediately.`)
        .addFields({ name: '🚀 Ready to Join?', value: 'Click the button below to start your application process.' })
        .setColor(0xFF8C00) // Orange-ish
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: "Modern Clean Application System" });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('apply_to_join_start')
            .setLabel('Apply To Join')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
    );

    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const existing = messages?.find(m => m.author.id === client.user.id && m.embeds[0]?.title?.includes("Application System"));

    if (existing) await existing.edit({ embeds: [embed], components: [row] });
    else await channel.send({ embeds: [embed], components: [row] });
}

client.on('guildMemberAdd', async (member) => {
    console.log(`[SYSTEM] New member joined: ${member.id}. Assigning Visitor role...`);
    await member.roles.add(config.ROLES.VISITOR).catch(() => {});
});

client.on('guildMemberRemove', async (member) => {
    console.log(`[SYSTEM] Member left: ${member.id}. Cleaning up data...`);
    ApplicationService.cleanupUserData(member.id);
});

async function registerCommands() {
    const commands = [
        {
            name: 'force-end-collab',
            description: 'Forcefully terminate a collaboration (Admin Only)',
            options: [{
                name: 'collab-id',
                type: ApplicationCommandOptionType.String,
                description: 'The ID of the collab',
                required: true
            }]
        },
        {
            name: 'collab-list',
            description: 'List all active collaborations (Admin Only)'
        },
        {
            name: 'collab-stats',
            description: 'View collaboration statistics for a user (Admin Only)',
            options: [{
                name: 'user',
                type: ApplicationCommandOptionType.User,
                description: 'The user to check stats for',
                required: true
            }]
        },
        {
            name: 'edit-rating',
            description: 'Edit a participant\'s rating for a specific collab (Admin Only)',
            options: [
                {
                    name: 'user',
                    type: ApplicationCommandOptionType.User,
                    description: 'The participant whose rating to edit',
                    required: true
                },
                {
                    name: 'collab-id',
                    type: ApplicationCommandOptionType.String,
                    description: 'The ID of the collaboration',
                    required: true
                },
                {
                    name: 'rating',
                    type: ApplicationCommandOptionType.Integer,
                    description: 'The new rating (1-5)',
                    required: true,
                    min_value: 1,
                    max_value: 5
                }
            ]
        },
        {
            name: 'timeout',
            description: 'Timeout a user (Moderator Only)',
            options: [
                {
                    name: 'target',
                    type: ApplicationCommandOptionType.User,
                    description: 'The user to timeout',
                    required: true
                },
                {
                    name: 'duration',
                    type: ApplicationCommandOptionType.String,
                    description: 'Duration (e.g., 20s, 10m, 1h, 1d)',
                    required: true
                }
            ]
        },
        {
            name: 'music',
            description: 'Send the music control panel'
        },
        {
            name: 'staff-controls',
            description: 'Send staff voice controls (Admin/Owner Only)'
        },
        {
            name: 'voice-panel',
            description: 'Send the voice management panel'
        }
    ];

    const rest = new REST({ version: '10' }).setToken(config.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, config.GUILD_ID), { body: commands });
        console.log('[SYSTEM] Slash commands registered.');
    } catch (error) {
        console.error('[SYSTEM] Error registering commands:', error);
    }
}

async function setupPanel() {
    const channel = client.channels.cache.get(config.CHANNELS.PANEL);
    if (!channel) return console.error("[SYSTEM] Panel channel not found!");

    const embed = new EmbedBuilder()
        .setTitle(`🎬 Welcome to ${config.BRANDING.NAME}`)
        .setDescription("Ready to create a professional video collaboration?\n\n**Rules:**\n- Ensure you meet the rank requirements.\n- Use the correct language for your target audience.\n- Be professional and respect participants.")
        .setColor(config.BRANDING.COLOR)
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: "CollabHub Production Grade System" });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('collab_create_start')
            .setLabel('Start New Collab')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎥')
    );

    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const existing = messages?.find(m => m.author.id === client.user.id && m.embeds[0]?.title?.includes("Welcome"));

    if (existing) await existing.edit({ embeds: [embed], components: [row] });
    else await channel.send({ embeds: [embed], components: [row] });
}

client.on('interactionCreate', async (interaction) => {
    try {
        await InteractionHandler.handle(interaction);
    } catch (error) {
        console.error('[SYSTEM] Global Interaction Error:', error);
        
        // Log Error to Channel
        const logChannel = client.channels.cache.get(config.CHANNELS.DYNAMIC_VOICE_LOGS);
        if (logChannel) {
            const errEmbed = new EmbedBuilder()
                .setTitle('❌ Global Interaction Error')
                .setDescription(`\`\`\`${error.message}\`\`\``)
                .setColor(0xFF0000)
                .setTimestamp();
            await logChannel.send({ embeds: [errEmbed] }).catch(() => {});
        }
    }
});

console.log("DEBUG TOKEN EXISTS:", !!process.env.TOKEN); 
console.log("DEBUG TOKEN TYPE:", typeof process.env.TOKEN); 
 
if (process.env.TOKEN) { 
    console.log("DEBUG TOKEN LENGTH:", process.env.TOKEN.length); 
    console.log("DEBUG TOKEN START:", process.env.TOKEN.slice(0, 10)); 
} 

client.login(process.env.TOKEN);
