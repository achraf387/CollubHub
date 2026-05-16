import { 
    createAudioPlayer, 
    createAudioResource, 
    joinVoiceChannel, 
    AudioPlayerStatus, 
    VoiceConnectionStatus, 
    entersState 
} from '@discordjs/voice';
import play from 'play-dl';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import config from '../config/config.js';

export const musicStates = new Map();
const logChannelId = '1502767041793360115';

export function initMusicSystem(client) {
    console.log('[SYSTEM] Music System Stabilized & Initialized');

    client.once('ready', async () => {
        const channel = await client.channels.fetch(logChannelId).catch(() => null);
        if (channel) {
            await channel.send({ 
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🎵 Music System Stabilized')
                        .setDescription('✅ **Core Playback Engine Restored**\n✅ **Queue Safety Applied**')
                        .setColor(0x57F287)
                        .setTimestamp()
                ] 
            });
        }
    });

    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isButton() && interaction.customId.startsWith('music_ctrl_')) {
                await handleMusicControls(interaction);
            }

            if (interaction.isModalSubmit() && interaction.customId === 'music_modal_submit') {
                await handleMusicModal(interaction);
            }
        } catch (err) {
            console.error('[MusicSystem] Interaction Error:', err);
        }
    });
}

async function handleMusicControls(interaction) {
    const { customId, member, channelId } = interaction;
    const [, , action, voiceChannelId] = customId.split('_');
    
    const state = musicStates.get(voiceChannelId);
    if (!state) return interaction.reply({ content: '❌ No active music session.', flags: 64 });

    if (!member.voice.channel || member.voice.channel.id !== voiceChannelId) {
        return interaction.reply({ content: '❌ You must be in the same voice channel.', flags: 64 });
    }

    switch (action) {
        case 'pause':
            state.player.pause();
            await interaction.reply({ content: '⏸️ Paused.', flags: 64 });
            break;
        case 'resume':
            state.player.unpause();
            await interaction.reply({ content: '▶️ Resumed.', flags: 64 });
            break;
        case 'skip':
            state.player.stop();
            await interaction.reply({ content: '⏭️ Skipped.', flags: 64 });
            break;
        case 'stop':
            state.queue = [];
            state.player.stop();
            await interaction.reply({ content: '⏹️ Stopped & Queue Cleared.', flags: 64 });
            break;
        case 'leave':
            cleanupMusic(voiceChannelId);
            await interaction.reply({ content: '🚪 Disconnected.', flags: 64 });
            break;
    }
}

async function handleMusicModal(interaction) {
    await interaction.deferReply({ flags: 64 });
    const query = interaction.fields.getTextInputValue('query');
    
    if (!interaction.member.voice.channel) {
        return interaction.editReply('❌ You must be in a voice channel.');
    }

    const result = await handleMusicPlay(interaction.guild, interaction.member.voice.channel, query, interaction.user.id);
    if (result.success) {
        await interaction.editReply(result.queued ? '✅ Added to queue!' : '🎶 Playing now!');
    } else {
        await interaction.editReply(`❌ ${result.error}`);
        await sendMusicLog(interaction.client, `❌ **Playback Failed**: ${result.error} (Input: ${query})`, 0xED4245);
    }
}

export async function handleMusicPlay(guild, channel, query, requesterId) {
    try {
        let finalUrl = null;
        let trackInfo = null;

        // STEP 1: VALIDATION & SEARCH
        if (query.startsWith('https://') || query.startsWith('http://')) {
            const validation = await play.validate(query).catch(() => null);
            if (validation && (validation === 'video' || validation === 'yt_video')) {
                const info = await play.video_info(query).catch(() => null);
                if (info && info.video_details) {
                    trackInfo = info.video_details;
                    finalUrl = trackInfo.url;
                }
            }
        } 
        
        if (!finalUrl) {
            const results = await play.search(query, { limit: 1 }).catch(() => []);
            if (results && results.length > 0) {
                trackInfo = results[0];
                finalUrl = trackInfo.url;
            }
        }

        // CRITICAL: NEVER pass undefined/null to stream()
        if (!finalUrl || typeof finalUrl !== 'string') {
            return { success: false, error: 'Could not find a valid track for your request.' };
        }

        let state = musicStates.get(channel.id);
        if (!state) {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: true
            });

            const player = createAudioPlayer();
            connection.subscribe(player);

            state = {
                queue: [],
                player: player,
                connection: connection,
                currentTrack: null,
                textChannel: channel,
                guild: guild
            };

            musicStates.set(channel.id, state);

            player.on(AudioPlayerStatus.Idle, () => {
                state.currentTrack = null;
                playNext(channel.id);
            });

            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
                    ]);
                } catch (e) {
                    cleanupMusic(channel.id);
                }
            });
        }

        const track = {
            title: trackInfo.title || 'Unknown Title',
            url: finalUrl,
            duration: trackInfo.durationRaw || 'N/A',
            thumbnail: trackInfo.thumbnails?.[0]?.url || null,
            requestedBy: requesterId
        };

        if (state.player.state.status === AudioPlayerStatus.Playing) {
            state.queue.push(track);
            const embed = new EmbedBuilder()
                .setTitle('📥 Added to Queue')
                .setDescription(`[${track.title}](${track.url})`)
                .setThumbnail(track.thumbnail)
                .setColor(0x3498DB)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
            return { success: true, queued: true };
        } else {
            state.currentTrack = track;
            await startPlayback(channel.id, track);
            return { success: true, queued: false };
        }

    } catch (err) {
        console.error('[MusicSystem] Play Handler Error:', err);
        return { success: false, error: 'Internal error during playback setup.' };
    }
}

async function startPlayback(channelId, track) {
    const state = musicStates.get(channelId);
    if (!state) return;

    try {
        // DOUBLE CHECK: Valid URL
        if (!track.url) throw new Error('Undefined Track URL');

        const stream = await play.stream(track.url);
        const resource = createAudioResource(stream.stream, { inputType: stream.type });
        state.player.play(resource);

        const embed = new EmbedBuilder()
            .setTitle('🎶 Now Playing')
            .setDescription(`[${track.title}](${track.url})`)
            .setThumbnail(track.thumbnail)
            .addFields(
                { name: '⏳ Duration', value: track.duration, inline: true },
                { name: '👤 Requested by', value: `<@${track.requestedBy}>`, inline: true }
            )
            .setColor(0x57F287)
            .setTimestamp();
        await state.textChannel.send({ embeds: [embed] });

    } catch (err) {
        console.error('[MusicSystem] Stream Error:', err);
        state.textChannel.send('❌ Failed to play track. Skipping...');
        await sendMusicLog(state.guild.client, `❌ **Stream Error**: ${err.message} (Track: ${track.url})`, 0xED4245);
        playNext(channelId);
    }
}

function playNext(channelId) {
    const state = musicStates.get(channelId);
    if (!state) return;

    if (state.queue.length > 0) {
        const track = state.queue.shift();
        state.currentTrack = track;
        startPlayback(channelId, track);
    } else {
        // Auto-leave after 5 mins inactivity
        setTimeout(() => {
            const currentState = musicStates.get(channelId);
            if (currentState && currentState.player.state.status === AudioPlayerStatus.Idle && currentState.queue.length === 0) {
                cleanupMusic(channelId);
                currentState.textChannel.send('💤 Leaving due to inactivity.');
            }
        }, 5 * 60 * 1000);
    }
}

export function cleanupMusic(channelId) {
    const state = musicStates.get(channelId);
    if (state) {
        state.player.stop();
        state.connection.destroy();
        musicStates.delete(channelId);
    }
}

export function getMusicControlButtons(channelId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`music_ctrl_pause_${channelId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setEmoji('⏸️'),
            new ButtonBuilder().setCustomId(`music_ctrl_resume_${channelId}`).setLabel('Resume').setStyle(ButtonStyle.Secondary).setEmoji('▶️'),
            new ButtonBuilder().setCustomId(`music_ctrl_skip_${channelId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary).setEmoji('⏭️'),
            new ButtonBuilder().setCustomId(`music_ctrl_stop_${channelId}`).setLabel('Stop').setStyle(ButtonStyle.Danger).setEmoji('⏹️'),
            new ButtonBuilder().setCustomId(`music_ctrl_leave_${channelId}`).setLabel('Leave').setStyle(ButtonStyle.Danger).setEmoji('🚪')
        )
    ];
}

async function sendMusicLog(client, message, color) {
    try {
        const channel = await client.channels.fetch(logChannelId).catch(() => null);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('🎶 Music System Log')
                .setDescription(message)
                .setColor(color)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('[MusicSystem] Logging Error:', err);
    }
}
