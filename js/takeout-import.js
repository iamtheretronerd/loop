// js/takeout-import.js
// Google Takeout Import Module for YouTube Music data

import { db } from './db.js';
import { syncManager } from './accounts/firestore.js';

/**
 * Parse YouTube Music Takeout files and import data
 */
export class TakeoutImporter {
    constructor(api) {
        this.api = api;
        this.files = [];
        this.onProgress = null;
        this.onComplete = null;
        this.aborted = false;
    }

    setFiles(files) {
        this.files = Array.from(files);
    }

    /**
     * Parse watch history from Takeout
     * Supports both JSON and HTML formats
     */
    async parseWatchHistory(content, filename) {
        const items = [];
        
        try {
            if (filename.endsWith('.json')) {
                const data = JSON.parse(content);
                // YouTube Takeout JSON format
                for (const item of data) {
                    if (item.titleUrl && item.title) {
                        const videoId = this.extractVideoId(item.titleUrl);
                        if (videoId) {
                            items.push({
                                videoId,
                                title: item.title.replace('Watched ', ''),
                                time: item.time,
                                subtitles: item.subtitles // Contains channel info
                            });
                        }
                    }
                }
            } else if (filename.endsWith('.html')) {
                // Parse HTML format
                const parser = new DOMParser();
                const doc = parser.parseFromString(content, 'text/html');
                const entries = doc.querySelectorAll('.content-cell');
                
                for (const entry of entries) {
                    const link = entry.querySelector('a[href*="youtube.com/watch"]');
                    if (link) {
                        const videoId = this.extractVideoId(link.href);
                        const title = link.textContent.trim();
                        if (videoId && title) {
                            items.push({ videoId, title });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to parse watch history:', error);
        }
        
        return items;
    }

    /**
     * Parse liked videos/songs from Takeout
     */
    async parseLikedContent(content, filename) {
        const items = [];
        
        try {
            if (filename.endsWith('.json')) {
                const data = JSON.parse(content);
                for (const item of data) {
                    const videoId = this.extractVideoId(item.contentDetails?.videoId || item.titleUrl);
                    if (videoId) {
                        items.push({
                            videoId,
                            title: item.snippet?.title || item.title?.replace('Liked ', '') || ''
                        });
                    }
                }
            } else if (filename.endsWith('.html')) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(content, 'text/html');
                const links = doc.querySelectorAll('a[href*="youtube.com/watch"]');
                
                for (const link of links) {
                    const videoId = this.extractVideoId(link.href);
                    if (videoId) {
                        items.push({
                            videoId,
                            title: link.textContent.trim()
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Failed to parse liked content:', error);
        }
        
        return items;
    }

    /**
     * Parse playlists from Takeout
     */
    async parsePlaylists(content, filename) {
        const playlists = [];
        
        try {
            if (filename.endsWith('.json')) {
                const data = JSON.parse(content);
                
                // Handle different playlist formats
                if (Array.isArray(data)) {
                    for (const playlist of data) {
                        const playlistData = {
                            name: playlist.snippet?.title || playlist.title || 'Imported Playlist',
                            description: playlist.snippet?.description || playlist.description || '',
                            videos: []
                        };
                        
                        // If playlist has items
                        if (playlist.items) {
                            for (const item of playlist.items) {
                                const videoId = item.contentDetails?.videoId || this.extractVideoId(item.titleUrl);
                                if (videoId) {
                                    playlistData.videos.push({
                                        videoId,
                                        title: item.snippet?.title || item.title || ''
                                    });
                                }
                            }
                        }
                        
                        playlists.push(playlistData);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to parse playlists:', error);
        }
        
        return playlists;
    }

    /**
     * Extract YouTube video ID from URL
     */
    extractVideoId(url) {
        if (!url) return null;
        
        // Handle direct video ID
        if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
            return url;
        }
        
        try {
            const urlObj = new URL(url);
            
            // youtube.com/watch?v=VIDEO_ID
            if (urlObj.searchParams.has('v')) {
                return urlObj.searchParams.get('v');
            }
            
            // youtu.be/VIDEO_ID
            if (urlObj.hostname === 'youtu.be') {
                return urlObj.pathname.slice(1);
            }
            
            // music.youtube.com/watch?v=VIDEO_ID
            if (urlObj.hostname.includes('youtube') && urlObj.searchParams.has('v')) {
                return urlObj.searchParams.get('v');
            }
        } catch {
            // Not a valid URL
        }
        
        // Try regex extraction
        const match = url.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/);
        return match ? match[1] : null;
    }

    /**
     * Search for a track on the streaming service by title/artist
     */
    async searchTrack(title, artist = '') {
        if (!title) return null;
        
        // Clean up title - remove common YouTube suffixes
        let cleanTitle = title
            .replace(/\s*\(Official.*?\)/gi, '')
            .replace(/\s*\[Official.*?\]/gi, '')
            .replace(/\s*\(Lyric.*?\)/gi, '')
            .replace(/\s*\[Lyric.*?\]/gi, '')
            .replace(/\s*\(Audio.*?\)/gi, '')
            .replace(/\s*\[Audio.*?\]/gi, '')
            .replace(/\s*\(Music Video.*?\)/gi, '')
            .replace(/\s*\[Music Video.*?\]/gi, '')
            .replace(/\s*-\s*Topic$/i, '')
            .trim();
        
        // Build search query
        let query = cleanTitle;
        if (artist && !cleanTitle.toLowerCase().includes(artist.toLowerCase())) {
            query = `${artist} ${cleanTitle}`;
        }
        
        try {
            const results = await this.api.searchTracks(query, { limit: 5 });
            
            if (results.items && results.items.length > 0) {
                // Return best match (first result)
                return results.items[0];
            }
        } catch (error) {
            console.warn('Search failed for:', query, error);
        }
        
        return null;
    }

    /**
     * Import items with progress tracking
     */
    async importItems(items, type, options = {}) {
        const results = {
            total: items.length,
            imported: 0,
            failed: 0,
            skipped: 0,
            tracks: []
        };
        
        for (let i = 0; i < items.length; i++) {
            if (this.aborted) break;
            
            const item = items[i];
            const progress = Math.round(((i + 1) / items.length) * 100);
            
            if (this.onProgress) {
                this.onProgress({
                    type,
                    current: i + 1,
                    total: items.length,
                    progress,
                    currentItem: item.title
                });
            }
            
            try {
                // Extract artist from subtitles if available
                let artist = '';
                if (item.subtitles && item.subtitles.length > 0) {
                    artist = item.subtitles[0].name || '';
                }
                
                // Search for track on streaming service
                const track = await this.searchTrack(item.title, artist);
                
                if (track) {
                    results.tracks.push(track);
                    
                    if (type === 'likes') {
                        // Add to liked songs
                        const added = await db.toggleFavorite('track', track);
                        if (added) {
                            syncManager.syncLibraryItem('track', track, true);
                            results.imported++;
                        } else {
                            results.skipped++; // Already liked
                        }
                    } else {
                        results.imported++;
                    }
                } else {
                    results.failed++;
                }
            } catch (error) {
                console.warn('Failed to import item:', item.title, error);
                results.failed++;
            }
            
            // Small delay to avoid rate limiting
            await this.delay(100);
        }
        
        return results;
    }

    /**
     * Import a playlist
     */
    async importPlaylist(playlistData) {
        const results = {
            name: playlistData.name,
            total: playlistData.videos.length,
            imported: 0,
            failed: 0,
            tracks: []
        };
        
        // Search for all tracks
        for (let i = 0; i < playlistData.videos.length; i++) {
            if (this.aborted) break;
            
            const video = playlistData.videos[i];
            const progress = Math.round(((i + 1) / playlistData.videos.length) * 100);
            
            if (this.onProgress) {
                this.onProgress({
                    type: 'playlist',
                    playlistName: playlistData.name,
                    current: i + 1,
                    total: playlistData.videos.length,
                    progress,
                    currentItem: video.title
                });
            }
            
            try {
                const track = await this.searchTrack(video.title);
                if (track) {
                    results.tracks.push(track);
                    results.imported++;
                } else {
                    results.failed++;
                }
            } catch (error) {
                results.failed++;
            }
            
            await this.delay(100);
        }
        
        // Create playlist in database
        if (results.tracks.length > 0) {
            try {
                const newPlaylist = await db.createPlaylist(
                    playlistData.name,
                    playlistData.description || `Imported from YouTube Music`
                );
                
                // Add tracks to playlist
                for (const track of results.tracks) {
                    await db.addTrackToPlaylist(newPlaylist.id, track);
                }
                
                // Sync to cloud
                const updatedPlaylist = await db.getPlaylist(newPlaylist.id);
                syncManager.syncUserPlaylist(updatedPlaylist, 'create');
                
                results.playlistId = newPlaylist.id;
            } catch (error) {
                console.error('Failed to create playlist:', error);
            }
        }
        
        return results;
    }

    /**
     * Read file content
     */
    async readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    /**
     * Detect file type based on filename
     */
    detectFileType(filename) {
        const lower = filename.toLowerCase();
        
        if (lower.includes('watch-history') || lower.includes('watch_history')) {
            return 'history';
        }
        if (lower.includes('liked') || lower.includes('like')) {
            return 'likes';
        }
        if (lower.includes('playlist')) {
            return 'playlist';
        }
        
        return 'unknown';
    }

    /**
     * Main import function
     */
    async startImport(options = {}) {
        const {
            importHistory = true,
            importLikes = true,
            importPlaylists = true
        } = options;
        
        this.aborted = false;
        const results = {
            history: null,
            likes: null,
            playlists: []
        };
        
        for (const file of this.files) {
            if (this.aborted) break;
            
            try {
                const content = await this.readFile(file);
                const fileType = this.detectFileType(file.name);
                
                if (fileType === 'history' && importHistory) {
                    const items = await this.parseWatchHistory(content, file.name);
                    if (items.length > 0) {
                        // Just collect unique tracks from history, don't import to likes
                        results.history = {
                            total: items.length,
                            parsed: items.length,
                            message: `Found ${items.length} items in watch history`
                        };
                    }
                } else if (fileType === 'likes' && importLikes) {
                    const items = await this.parseLikedContent(content, file.name);
                    if (items.length > 0) {
                        results.likes = await this.importItems(items, 'likes');
                    }
                } else if (fileType === 'playlist' && importPlaylists) {
                    const playlists = await this.parsePlaylists(content, file.name);
                    for (const playlist of playlists) {
                        if (this.aborted) break;
                        const playlistResult = await this.importPlaylist(playlist);
                        results.playlists.push(playlistResult);
                    }
                }
            } catch (error) {
                console.error('Failed to process file:', file.name, error);
            }
        }
        
        if (this.onComplete) {
            this.onComplete(results);
        }
        
        return results;
    }

    abort() {
        this.aborted = true;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Initialize Takeout Import UI
 */
export function initializeTakeoutImport(api) {
    const fileInput = document.getElementById('takeout-file-input');
    const selectBtn = document.getElementById('takeout-select-files-btn');
    const filesSelectedText = document.getElementById('takeout-files-selected');
    const startBtn = document.getElementById('takeout-start-import-btn');
    const statusText = document.getElementById('takeout-import-status');
    const progressContainer = document.getElementById('takeout-progress-container');
    const progressFill = document.getElementById('takeout-progress-fill');
    const progressText = document.getElementById('takeout-progress-text');
    const resultsContainer = document.getElementById('takeout-results');
    
    const importHistoryCheckbox = document.getElementById('takeout-import-history');
    const importLikesCheckbox = document.getElementById('takeout-import-likes');
    const importPlaylistsCheckbox = document.getElementById('takeout-import-playlists');
    
    if (!selectBtn || !fileInput) return;
    
    let importer = new TakeoutImporter(api);
    
    selectBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', () => {
        const files = fileInput.files;
        if (files.length > 0) {
            filesSelectedText.textContent = `${files.length} file(s) selected`;
            startBtn.disabled = false;
            importer.setFiles(files);
            resultsContainer.style.display = 'none';
        } else {
            filesSelectedText.textContent = '';
            startBtn.disabled = true;
        }
    });
    
    startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        selectBtn.disabled = true;
        progressContainer.style.display = 'block';
        resultsContainer.style.display = 'none';
        statusText.textContent = 'Importing...';
        
        importer.onProgress = (data) => {
            progressFill.style.width = `${data.progress}%`;
            if (data.playlistName) {
                progressText.textContent = `Importing playlist "${data.playlistName}": ${data.current}/${data.total} - ${data.currentItem}`;
            } else {
                progressText.textContent = `${data.type}: ${data.current}/${data.total} - ${data.currentItem}`;
            }
        };
        
        importer.onComplete = (results) => {
            progressContainer.style.display = 'none';
            displayResults(results);
            statusText.textContent = 'Import complete!';
            selectBtn.disabled = false;
        };
        
        try {
            await importer.startImport({
                importHistory: importHistoryCheckbox?.checked ?? true,
                importLikes: importLikesCheckbox?.checked ?? true,
                importPlaylists: importPlaylistsCheckbox?.checked ?? true
            });
        } catch (error) {
            console.error('Import failed:', error);
            statusText.textContent = 'Import failed: ' + error.message;
            progressContainer.style.display = 'none';
            selectBtn.disabled = false;
        }
    });
    
    function displayResults(results) {
        resultsContainer.style.display = 'block';
        
        let html = '<h4 style="margin-bottom: 0.5rem;">Import Results</h4>';
        
        if (results.history) {
            html += `<p>📜 History: ${results.history.message}</p>`;
        }
        
        if (results.likes) {
            html += `<p>❤️ Liked Songs: ${results.likes.imported} imported, ${results.likes.failed} not found, ${results.likes.skipped} already liked</p>`;
        }
        
        if (results.playlists.length > 0) {
            html += `<p>📁 Playlists:</p><ul style="margin-left: 1rem;">`;
            for (const playlist of results.playlists) {
                html += `<li>${playlist.name}: ${playlist.imported}/${playlist.total} tracks imported</li>`;
            }
            html += `</ul>`;
        }
        
        if (!results.history && !results.likes && results.playlists.length === 0) {
            html += `<p>No compatible data found in the selected files. Make sure you're uploading files from Google Takeout's YouTube/YouTube Music export.</p>`;
        }
        
        resultsContainer.innerHTML = html;
    }
}
