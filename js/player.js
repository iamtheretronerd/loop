//js/player.js
import { MediaPlayer } from 'dashjs';
import {
    REPEAT_MODE,
    formatTime,
    getTrackArtists,
    getTrackTitle,
    getTrackArtistsHTML,
    createQualityBadgeHTML,
} from './utils.js';
import { queueManager, replayGainSettings } from './storage.js';
import { GroqService } from './groq.js';
import { db } from './db.js';
import { showNotification } from './downloads.js';

export class Player {
    constructor(audioElement, api, quality = 'LOSSLESS') {
        this.audio = audioElement;
        this.api = api;
        this.quality = quality;
        this.queue = [];
        this.shuffledQueue = [];
        this.originalQueueBeforeShuffle = [];
        this.currentQueueIndex = -1;
        this.currentQueueIndex = -1;
        this.shuffleActive = false;
        this.smartShuffleActive = false;
        this.repeatMode = REPEAT_MODE.OFF;
        this.groqService = new GroqService();
        this.preloadCache = new Map();
        this.preloadAbortController = null;
        this.currentTrack = null;
        this.currentRgValues = null;
        this.userVolume = parseFloat(localStorage.getItem('volume') || '0.7');

        // Autoqueue (Radio) mode - fills queue with recommendations when playing single track
        this.autoqueueEnabled = false;
        this.autoqueueLoading = false;
        this.autoqueueSeeds = []; // Tracks used as seeds for recommendations

        // Sleep timer properties
        this.sleepTimer = null;
        this.sleepTimerEndTime = null;
        this.sleepTimerInterval = null;

        // Initialize dash.js player
        this.dashPlayer = MediaPlayer().create();
        this.dashPlayer.updateSettings({
            streaming: {
                buffer: {
                    fastSwitchEnabled: true,
                },
            },
        });
        this.dashInitialized = false;

        this.loadQueueState();
        this.setupMediaSession();

        window.addEventListener('beforeunload', () => {
            this.saveQueueState();
        });
    }

    setVolume(value) {
        this.userVolume = Math.max(0, Math.min(1, value));
        localStorage.setItem('volume', this.userVolume);
        this.applyReplayGain();
    }

    applyReplayGain() {
        const mode = replayGainSettings.getMode(); // 'off', 'track', 'album'
        let gainDb = 0;
        let peak = 1.0;

        if (mode !== 'off' && this.currentRgValues) {
            const { trackReplayGain, trackPeakAmplitude, albumReplayGain, albumPeakAmplitude } = this.currentRgValues;

            if (mode === 'album' && albumReplayGain !== undefined) {
                gainDb = albumReplayGain;
                peak = albumPeakAmplitude || 1.0;
            } else if (trackReplayGain !== undefined) {
                gainDb = trackReplayGain;
                peak = trackPeakAmplitude || 1.0;
            }

            // Apply Pre-Amp
            gainDb += replayGainSettings.getPreamp();
        }

        // Convert dB to linear scale: 10^(dB/20)
        let scale = Math.pow(10, gainDb / 20);

        // Peak protection (prevent clipping)
        if (scale * peak > 1.0) {
            scale = 1.0 / peak;
        }

        // Calculate effective volume
        const effectiveVolume = this.userVolume * scale;

        // Apply to audio element
        this.audio.volume = Math.max(0, Math.min(1, effectiveVolume));
    }

    loadQueueState() {
        const savedState = queueManager.getQueue();
        if (savedState) {
            this.queue = savedState.queue || [];
            this.shuffledQueue = savedState.shuffledQueue || [];
            this.originalQueueBeforeShuffle = savedState.originalQueueBeforeShuffle || [];
            this.currentQueueIndex = savedState.currentQueueIndex ?? -1;
            this.shuffleActive = savedState.shuffleActive || false;
            this.smartShuffleActive = savedState.smartShuffleActive || false;
            this.repeatMode = savedState.repeatMode || REPEAT_MODE.OFF;
            this.autoqueueEnabled = savedState.autoqueueEnabled || false;
            this.autoqueueSeeds = savedState.autoqueueSeeds || [];

            // Restore current track if queue exists and index is valid
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
            if (this.currentQueueIndex >= 0 && this.currentQueueIndex < currentQueue.length) {
                this.currentTrack = currentQueue[this.currentQueueIndex];

                // Restore UI
                const track = this.currentTrack;
                const trackTitle = getTrackTitle(track);
                const trackArtistsHTML = getTrackArtistsHTML(track);

                let yearDisplay = '';
                const releaseDate = track.album?.releaseDate || track.streamStartDate;
                if (releaseDate) {
                    const date = new Date(releaseDate);
                    if (!isNaN(date.getTime())) {
                        yearDisplay = ` • ${date.getFullYear()}`;
                    }
                }

                const coverEl = document.querySelector('.now-playing-bar .cover');
                const titleEl = document.querySelector('.now-playing-bar .title');
                const artistEl = document.querySelector('.now-playing-bar .artist');

                if (coverEl) coverEl.src = this.api.getCoverUrl(track.album?.cover);
                if (titleEl) {
                    const qualityBadge = createQualityBadgeHTML(track);
                    titleEl.innerHTML = `${trackTitle} ${qualityBadge}`;
                }
                if (artistEl) artistEl.innerHTML = trackArtistsHTML + yearDisplay;

                const mixBtn = document.getElementById('now-playing-mix-btn');
                if (mixBtn) {
                    mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
                }
                const totalDurationEl = document.getElementById('total-duration');
                if (totalDurationEl) totalDurationEl.textContent = formatTime(track.duration);
                document.title = `${trackTitle} • ${getTrackArtists(track)}`;

                this.updatePlayingTrackIndicator();
                this.updateMediaSession(track);
            }
        }
    }

    saveQueueState() {
        queueManager.saveQueue({
            queue: this.queue,
            shuffledQueue: this.shuffledQueue,
            originalQueueBeforeShuffle: this.originalQueueBeforeShuffle,
            currentQueueIndex: this.currentQueueIndex,
            shuffleActive: this.shuffleActive,
            smartShuffleActive: this.smartShuffleActive,
            repeatMode: this.repeatMode,
            autoqueueEnabled: this.autoqueueEnabled,
            autoqueueSeeds: this.autoqueueSeeds,
        });
    }

    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', () => {
            this.audio.play().catch(console.error);
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            this.audio.pause();
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            this.playPrev();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            this.playNext();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 10;
            this.seekBackward(skipTime);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 10;
            this.seekForward(skipTime);
        });

        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                this.audio.currentTime = Math.max(0, details.seekTime);
                this.updateMediaSessionPositionState();
            }
        });

        navigator.mediaSession.setActionHandler('stop', () => {
            this.audio.pause();
            this.audio.currentTime = 0;
            this.updateMediaSessionPlaybackState();
        });
    }

    setQuality(quality) {
        this.quality = quality;
    }

    async preloadNextTracks() {
        if (this.preloadAbortController) {
            this.preloadAbortController.abort();
        }

        this.preloadAbortController = new AbortController();
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const tracksToPreload = [];

        for (let i = 1; i <= 2; i++) {
            const nextIndex = this.currentQueueIndex + i;
            if (nextIndex < currentQueue.length) {
                tracksToPreload.push({ track: currentQueue[nextIndex], index: nextIndex });
            }
        }

        for (const { track } of tracksToPreload) {
            if (this.preloadCache.has(track.id)) continue;
            if (track.isLocal) continue;
            try {
                const streamUrl = await this.api.getStreamUrl(track.id, this.quality);

                if (this.preloadAbortController.signal.aborted) break;

                this.preloadCache.set(track.id, streamUrl);
                // Warm connection/cache
                // For Blob URLs (DASH), this head request is not needed and can cause errors.
                if (!streamUrl.startsWith('blob:')) {
                    fetch(streamUrl, { method: 'HEAD', signal: this.preloadAbortController.signal }).catch(() => {});
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    // console.debug('Failed to get stream URL for preload:', trackTitle);
                }
            }
        }
    }

    async playTrackFromQueue(startTime = 0) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (this.currentQueueIndex < 0 || this.currentQueueIndex >= currentQueue.length) {
            return;
        }

        this.saveQueueState();

        const track = currentQueue[this.currentQueueIndex];
        this.currentTrack = track;

        const trackTitle = getTrackTitle(track);
        const trackArtistsHTML = getTrackArtistsHTML(track);

        let yearDisplay = '';
        const releaseDate = track.album?.releaseDate || track.streamStartDate;
        if (releaseDate) {
            const date = new Date(releaseDate);
            if (!isNaN(date.getTime())) {
                yearDisplay = ` • ${date.getFullYear()}`;
            }
        }

        document.querySelector('.now-playing-bar .cover').src = this.api.getCoverUrl(track.album?.cover);
        const qualityBadge = createQualityBadgeHTML(track);
        document.querySelector('.now-playing-bar .title').innerHTML = `${trackTitle} ${qualityBadge}`;
        document.querySelector('.now-playing-bar .artist').innerHTML = trackArtistsHTML + yearDisplay;

        const mixBtn = document.getElementById('now-playing-mix-btn');
        if (mixBtn) {
            mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
        }
        document.title = `${trackTitle} • ${getTrackArtists(track)}`;

        this.updatePlayingTrackIndicator();

        try {
            let streamUrl;

            if (track.isLocal && track.file) {
                this.dashPlayer.reset(); // Ensure dash is off
                streamUrl = URL.createObjectURL(track.file);
                this.currentRgValues = null; // No replaygain for local files yet
                this.applyReplayGain();

                this.audio.src = streamUrl;
                if (startTime > 0) {
                    this.audio.currentTime = startTime;
                }
                await this.audio.play();
            } else {
                // Get track data for ReplayGain (should be cached by API)
                const trackData = await this.api.getTrack(track.id, this.quality);

                if (trackData && trackData.info) {
                    this.currentRgValues = {
                        trackReplayGain: trackData.info.trackReplayGain,
                        trackPeakAmplitude: trackData.info.trackPeakAmplitude,
                        albumReplayGain: trackData.info.albumReplayGain,
                        albumPeakAmplitude: trackData.info.albumPeakAmplitude,
                    };
                } else {
                    this.currentRgValues = null;
                }
                this.applyReplayGain();

                if (this.preloadCache.has(track.id)) {
                    streamUrl = this.preloadCache.get(track.id);
                } else if (trackData.originalTrackUrl) {
                    streamUrl = trackData.originalTrackUrl;
                } else {
                    streamUrl = this.api.extractStreamUrlFromManifest(trackData.info.manifest);
                }

                // Handle playback
                if (streamUrl && streamUrl.startsWith('blob:') && !track.isLocal) {
                    // It's likely a DASH manifest blob URL
                    this.dashPlayer.initialize(this.audio, streamUrl, true);
                    this.dashInitialized = true;
                    if (startTime > 0) {
                        this.dashPlayer.seek(startTime);
                    }
                } else {
                    if (this.dashInitialized) {
                        this.dashPlayer.reset();
                        this.dashInitialized = false;
                    }
                    this.audio.src = streamUrl;
                    if (startTime > 0) {
                        this.audio.currentTime = startTime;
                    }
                    await this.audio.play();
                }
            }

            // Update Media Session AFTER play starts to ensure metadata is captured
            this.updateMediaSession(track);
            this.updateMediaSessionPlaybackState();
            this.preloadNextTracks();
        } catch (error) {
            console.error(`Could not play track: ${trackTitle}`, error);
        }
    }

    playAtIndex(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (index >= 0 && index < currentQueue.length) {
            this.currentQueueIndex = index;
            this.playTrackFromQueue();
        }
    }

    playNext() {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const isLastTrack = this.currentQueueIndex >= currentQueue.length - 1;
        const isNearEnd = this.currentQueueIndex >= currentQueue.length - 3;

        if (this.repeatMode === REPEAT_MODE.ONE) {
            this.audio.currentTime = 0;
            this.audio.play();
            return;
        }

        // If autoqueue is enabled and we're near the end, fetch more recommendations
        if (this.autoqueueEnabled && isNearEnd && !this.autoqueueLoading) {
            this.fetchAutoqueueRecommendations();
        }

        if (!isLastTrack) {
            this.currentQueueIndex++;
        } else if (this.repeatMode === REPEAT_MODE.ALL) {
            this.currentQueueIndex = 0;
        } else if (this.autoqueueEnabled) {
            // In autoqueue mode, wait for more tracks or stay on last
            return;
        } else {
            return;
        }

        this.playTrackFromQueue();
    }

    playPrev() {
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            this.updateMediaSessionPositionState();
        } else if (this.currentQueueIndex > 0) {
            this.currentQueueIndex--;
            this.playTrackFromQueue();
        }
    }

    handlePlayPause() {
        if (!this.audio.src || this.audio.error) {
            if (this.currentTrack) {
                this.playTrackFromQueue();
            }
            return;
        }

        if (this.audio.paused) {
            this.audio.play().catch((e) => {
                if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
                console.error('Play failed, reloading track:', e);
                if (this.currentTrack) {
                    this.playTrackFromQueue();
                }
            });
        } else {
            this.audio.pause();
            this.saveQueueState();
        }
    }

    seekBackward(seconds = 10) {
        const newTime = Math.max(0, this.audio.currentTime - seconds);
        this.audio.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    seekForward(seconds = 10) {
        const duration = this.audio.duration || 0;
        const newTime = Math.min(duration, this.audio.currentTime + seconds);
        this.audio.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    async toggleShuffle() {
        if (!this.shuffleActive && !this.smartShuffleActive) {
            // OFF -> SHUFFLE
            this.shuffleActive = true;
            this.smartShuffleActive = false;

            this.originalQueueBeforeShuffle = [...this.queue];
            const currentTrack = this.queue[this.currentQueueIndex];

            const tracksToShuffle = [...this.queue];
            if (currentTrack && this.currentQueueIndex >= 0) {
                tracksToShuffle.splice(this.currentQueueIndex, 1);
            }

            tracksToShuffle.sort(() => Math.random() - 0.5);

            if (currentTrack) {
                this.shuffledQueue = [currentTrack, ...tracksToShuffle];
                this.currentQueueIndex = 0;
            } else {
                this.shuffledQueue = tracksToShuffle;
                this.currentQueueIndex = -1;
            }
        } else if (this.shuffleActive && !this.smartShuffleActive) {
            // SHUFFLE -> SMART SHUFFLE
            this.smartShuffleActive = true;
            try {
                await this.enableSmartShuffle();
                showNotification('Smart Shuffle activated with AI recommendations!');
            } catch (error) {
                console.error('Failed to enable smart shuffle:', error);
                showNotification('Smart Shuffle failed: ' + error.message);
                this.smartShuffleActive = false;
                this.shuffleActive = false; // Return to off state on failure
            }
        } else {
            // SMART -> OFF
            this.shuffleActive = false;
            this.smartShuffleActive = false;
            
            const currentTrack = this.shuffledQueue[this.currentQueueIndex];
            this.queue = [...this.originalQueueBeforeShuffle];
            this.currentQueueIndex = this.queue.findIndex((t) => t.id === currentTrack?.id);
        }

        this.preloadCache.clear();
        this.preloadNextTracks();
        this.saveQueueState();
    }

    async enableSmartShuffle() {
        // Get user history (last 10 tracks)
        const history = await db.getHistory();
        const lastPlayed = history.slice(0, 10).map((h) => ({
            title: h.title,
            artist: typeof h.artist === 'object' ? h.artist.name : h.artist,
        }));

        // Get current queue context (next 20 tracks)
        const currentQueue = this.shuffledQueue.length > 0 ? this.shuffledQueue : this.queue;
        const contextTracks = currentQueue.slice(this.currentQueueIndex + 1, this.currentQueueIndex + 21);
        const context = contextTracks.map((t) => ({
            title: t.title,
            artist: typeof t.artist === 'object' ? t.artist.name : (Array.isArray(t.artists) ? t.artists[0].name : 'Unknown'),
        }));

        if (lastPlayed.length === 0 && context.length === 0) {
            console.warn('Not enough context for smart shuffle');
            return;
        }

        const recommendations = await this.groqService.getRecommendations(lastPlayed, context);
        
        if (recommendations.length === 0) return;

        let addedCount = 0;
        // Search and inject tracks
        for (const rec of recommendations) {
            try {
                const query = `${rec.title} ${rec.artist}`;
                const searchRes = await this.api.searchTracks(query, { limit: 1 });
                
                if (searchRes.items && searchRes.items.length > 0) {
                    const track = searchRes.items[0];
                    // Verify it's not a duplicate of current track or next few tracks
                    const isDuplicate = contextTracks.some(t => t.id === track.id) || 
                                      (this.currentTrack && this.currentTrack.id === track.id);
                    
                    if (!isDuplicate) {
                        track.isRecommendation = true; // Flag for UI if needed
                        
                        // Insert at random position in the next 10 spots to mix it in
                        // Ensure we don't mess up currentQueueIndex
                        const insertOffset = Math.floor(Math.random() * 10) + 1;
                        const insertIndex = this.currentQueueIndex + insertOffset + addedCount;
                        
                        if (insertIndex < this.shuffledQueue.length) {
                             this.shuffledQueue.splice(insertIndex, 0, track);
                        } else {
                             this.shuffledQueue.push(track);
                        }
                        addedCount++;
                    }
                }
            } catch (e) {
                console.error(`Failed to add recommended track: ${rec.title}`, e);
            }
        }
    }

    async startSmartShuffle(tracks) {
        // 1. Set standard queue (resets state)
        this.setQueue(tracks, 0);

        // 2. Setup shuffle state manually
        this.shuffleActive = true;
        this.smartShuffleActive = true;
        this.originalQueueBeforeShuffle = [...this.queue];

        // 3. Create shuffled queue (randomize all)
        const shuffled = [...this.queue];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        this.shuffledQueue = shuffled;
        this.currentQueueIndex = 0;

        // 4. Inject recommendations
        await this.enableSmartShuffle();
        
        // 5. Save state
        this.saveQueueState();
    }

    toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        this.saveQueueState();
        return this.repeatMode;
    }

    setQueue(tracks, startIndex = 0, autoqueue = false) {
        this.queue = tracks;
        this.currentQueueIndex = startIndex;
        this.shuffleActive = false;
        this.smartShuffleActive = false;
        this.autoqueueEnabled = autoqueue;
        this.autoqueueLoading = false;
        this.autoqueueSeeds = autoqueue && tracks.length > 0 ? [tracks[0]] : [];
        this.preloadCache.clear();
        this.saveQueueState();

        // If autoqueue is enabled with a single track, start fetching recommendations
        if (autoqueue && tracks.length === 1) {
            this.fetchAutoqueueRecommendations();
        }
    }

    /**
     * Fetches recommendations for autoqueue (radio) mode
     * Uses current track, history, and likes as seeds
     */
    async fetchAutoqueueRecommendations() {
        if (this.autoqueueLoading || !this.autoqueueEnabled) return;
        
        this.autoqueueLoading = true;
        console.log('[Autoqueue] Fetching recommendations...');
        
        try {
            // Build seed tracks from current track, history, and likes
            const seedTracks = [];
            
            // Add current track as primary seed
            if (this.currentTrack) {
                seedTracks.push(this.currentTrack);
            }
            
            // Add saved autoqueue seeds
            for (const seed of this.autoqueueSeeds) {
                if (!seedTracks.some(t => t.id === seed.id)) {
                    seedTracks.push(seed);
                }
            }
            
            // Get recent history for additional context
            try {
                const history = await db.getHistory();
                const recentHistory = history.slice(0, 5);
                for (const item of recentHistory) {
                    if (!seedTracks.some(t => t.id === item.id)) {
                        seedTracks.push(item);
                    }
                }
            } catch (e) {
                console.warn('[Autoqueue] Could not get history:', e);
            }
            
            // Get some liked tracks for variety
            try {
                const likes = await db.getFavorites('track');
                // Get random liked tracks
                const shuffledLikes = likes.sort(() => 0.5 - Math.random()).slice(0, 3);
                for (const item of shuffledLikes) {
                    if (!seedTracks.some(t => t.id === item.id)) {
                        seedTracks.push(item);
                    }
                }
            } catch (e) {
                console.warn('[Autoqueue] Could not get likes:', e);
            }
            
            console.log(`[Autoqueue] Using ${seedTracks.length} seed tracks`);
            
            // Get recommendations from API
            const recommendations = await this.api.getRecommendedTracksForPlaylist(seedTracks, 15);
            
            if (!recommendations || recommendations.length === 0) {
                console.warn('[Autoqueue] No recommendations received');
                this.autoqueueLoading = false;
                return;
            }
            
            // Filter out tracks already in queue
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
            const existingIds = new Set(currentQueue.map(t => t.id));
            
            const newTracks = recommendations.filter(track => !existingIds.has(track.id));
            
            console.log(`[Autoqueue] Adding ${newTracks.length} new tracks to queue`);
            
            // Add new tracks to queue
            for (const track of newTracks) {
                track.isAutoqueue = true; // Flag for UI if needed
                this.queue.push(track);
            }
            
            // Update seeds with some of the new tracks for next fetch
            if (newTracks.length > 0) {
                this.autoqueueSeeds = [
                    this.currentTrack,
                    ...newTracks.slice(0, 3)
                ].filter(Boolean);
            }
            
            this.saveQueueState();
            this.preloadNextTracks();
            
        } catch (error) {
            console.error('[Autoqueue] Failed to fetch recommendations:', error);
        } finally {
            this.autoqueueLoading = false;
        }
    }

    addToQueue(track) {
        this.queue.push(track);

        if (!this.currentTrack || this.currentQueueIndex === -1) {
            this.currentQueueIndex = this.queue.length - 1;
            this.playTrackFromQueue();
        }
        this.saveQueueState();
    }

    addNextToQueue(track) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const insertIndex = this.currentQueueIndex + 1;

        // Insert after current track
        currentQueue.splice(insertIndex, 0, track);

        // If we are shuffling, we might want to also add it to the original queue for consistency,
        // though syncing that is tricky. The standard logic often just appends to the active queue view.
        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle.push(track); // Just append to end of main list? Or logic needed.
            // Simplest is to just modify the active playing queue.
        } else {
            // In linear mode, `currentQueue` IS `this.queue`
        }

        this.saveQueueState();
        this.preloadNextTracks(); // Update preload since next track changed
    }

    removeFromQueue(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        // If removing current track
        if (index === this.currentQueueIndex) {
            // If playing, we might want to stop or just let it finish?
            // For now, let's just remove it.
            // If it's the last track, playback will stop naturally or we handle it?
        }

        if (index < this.currentQueueIndex) {
            this.currentQueueIndex--;
        }

        const removedTrack = currentQueue.splice(index, 1)[0];

        if (this.shuffleActive) {
            // Also remove from original queue
            const originalIndex = this.originalQueueBeforeShuffle.findIndex((t) => t.id === removedTrack.id); // Simple ID check
            if (originalIndex !== -1) {
                this.originalQueueBeforeShuffle.splice(originalIndex, 1);
            }
        }

        this.saveQueueState();
        this.preloadNextTracks();
    }

    clearQueue() {
        this.queue = [];
        this.shuffledQueue = [];
        this.originalQueueBeforeShuffle = [];
        this.currentQueueIndex = -1;
        this.preloadCache.clear();
        this.saveQueueState();
    }

    moveInQueue(fromIndex, toIndex) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        if (fromIndex < 0 || fromIndex >= currentQueue.length) return;
        if (toIndex < 0 || toIndex >= currentQueue.length) return;

        const [track] = currentQueue.splice(fromIndex, 1);
        currentQueue.splice(toIndex, 0, track);

        if (this.currentQueueIndex === fromIndex) {
            this.currentQueueIndex = toIndex;
        } else if (fromIndex < this.currentQueueIndex && toIndex >= this.currentQueueIndex) {
            this.currentQueueIndex--;
        } else if (fromIndex > this.currentQueueIndex && toIndex <= this.currentQueueIndex) {
            this.currentQueueIndex++;
        }
        this.saveQueueState();
    }

    getCurrentQueue() {
        return this.shuffleActive ? this.shuffledQueue : this.queue;
    }

    getNextTrack() {
        const currentQueue = this.getCurrentQueue();
        if (this.currentQueueIndex === -1 || currentQueue.length === 0) return null;

        const nextIndex = this.currentQueueIndex + 1;
        if (nextIndex < currentQueue.length) {
            return currentQueue[nextIndex];
        } else if (this.repeatMode === REPEAT_MODE.ALL) {
            return currentQueue[0];
        }
        return null;
    }

    updatePlayingTrackIndicator() {
        const currentTrack = this.getCurrentQueue()[this.currentQueueIndex];
        document.querySelectorAll('.track-item').forEach((item) => {
            item.classList.toggle('playing', currentTrack && item.dataset.trackId == currentTrack.id);
        });

        document.querySelectorAll('.queue-track-item').forEach((item) => {
            const index = parseInt(item.dataset.queueIndex);
            item.classList.toggle('playing', index === this.currentQueueIndex);
        });
    }

    updateMediaSession(track) {
        if (!('mediaSession' in navigator)) return;

        // Force a refresh for picky Bluetooth systems by clearing metadata first
        navigator.mediaSession.metadata = null;

        const artwork = [];
        const sizes = ['320'];
        const coverId = track.album?.cover;
        const trackTitle = getTrackTitle(track);

        if (coverId) {
            sizes.forEach((size) => {
                artwork.push({
                    src: this.api.getCoverUrl(coverId, size),
                    sizes: `${size}x${size}`,
                    type: 'image/jpeg',
                });
            });
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: trackTitle || 'Unknown Title',
            artist: getTrackArtists(track) || 'Unknown Artist',
            album: track.album?.title || 'Unknown Album',
            artwork: artwork.length > 0 ? artwork : undefined,
        });

        this.updateMediaSessionPlaybackState();
        this.updateMediaSessionPositionState();
    }

    updateMediaSessionPlaybackState() {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
    }

    updateMediaSessionPositionState() {
        if (!('mediaSession' in navigator)) return;
        if (!('setPositionState' in navigator.mediaSession)) return;

        const duration = this.audio.duration;

        if (!duration || isNaN(duration) || !isFinite(duration)) {
            return;
        }

        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: this.audio.playbackRate || 1,
                position: Math.min(this.audio.currentTime, duration),
            });
        } catch (error) {
            console.log('Failed to update Media Session position:', error);
        }
    }

    // Sleep Timer Methods
    setSleepTimer(minutes) {
        this.clearSleepTimer(); // Clear any existing timer

        this.sleepTimerEndTime = Date.now() + minutes * 60 * 1000;

        this.sleepTimer = setTimeout(
            () => {
                this.audio.pause();
                this.clearSleepTimer();
                this.updateSleepTimerUI();
            },
            minutes * 60 * 1000
        );

        // Update UI every second
        this.sleepTimerInterval = setInterval(() => {
            this.updateSleepTimerUI();
        }, 1000);

        this.updateSleepTimerUI();
    }

    clearSleepTimer() {
        if (this.sleepTimer) {
            clearTimeout(this.sleepTimer);
            this.sleepTimer = null;
        }
        if (this.sleepTimerInterval) {
            clearInterval(this.sleepTimerInterval);
            this.sleepTimerInterval = null;
        }
        this.sleepTimerEndTime = null;
        this.updateSleepTimerUI();
    }

    getSleepTimerRemaining() {
        if (!this.sleepTimerEndTime) return null;
        const remaining = Math.max(0, this.sleepTimerEndTime - Date.now());
        return Math.ceil(remaining / 1000); // Return seconds remaining
    }

    isSleepTimerActive() {
        return this.sleepTimer !== null;
    }

    updateSleepTimerUI() {
        const timerBtn = document.getElementById('sleep-timer-btn');
        const timerBtnDesktop = document.getElementById('sleep-timer-btn-desktop');

        const updateBtn = (btn) => {
            if (!btn) return;
            if (this.isSleepTimerActive()) {
                const remaining = this.getSleepTimerRemaining();
                if (remaining > 0) {
                    const minutes = Math.floor(remaining / 60);
                    const seconds = remaining % 60;
                    btn.innerHTML = `<span style="font-size: 12px; font-weight: bold;">${minutes}:${seconds.toString().padStart(2, '0')}</span>`;
                    btn.title = `Sleep Timer: ${minutes}:${seconds.toString().padStart(2, '0')} remaining`;
                    btn.classList.add('active');
                    btn.style.color = 'var(--primary)';
                } else {
                    btn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12,6 12,12 16,14"/>
                        </svg>
                    `;
                    btn.title = 'Sleep Timer';
                    btn.classList.remove('active');
                    btn.style.color = '';
                }
            } else {
                btn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12,6 12,12 16,14"/>
                    </svg>
                `;
                btn.title = 'Sleep Timer';
                btn.classList.remove('active');
                btn.style.color = '';
            }
        };

        updateBtn(timerBtn);
        updateBtn(timerBtnDesktop);
    }
}
