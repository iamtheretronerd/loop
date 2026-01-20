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
     * Supports JSON, HTML, and CSV formats
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
            } else if (filename.endsWith('.csv')) {
                // Parse CSV format - YouTube Music library exports as CSV
                const rows = this.parseCSV(content);
                
                for (const row of rows) {
                    // YouTube Music CSV typically has: Title, Artist, Album, Playlist ID, etc.
                    const title = row['Title'] || row['Song'] || row['Name'] || row[0];
                    const artist = row['Artist'] || row['Channel'] || row[1];
                    
                    if (title && title !== 'Title') {
                        items.push({
                            title: title.trim(),
                            artist: artist ? artist.trim() : '',
                            album: row['Album'] || ''
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
     * Supports JSON and CSV formats
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
            } else if (filename.endsWith('.csv')) {
                // Parse CSV format - YouTube Music playlist export
                const rows = this.parseCSV(content);
                
                // Extract playlist name from filename if possible
                // e.g., "My Playlist.csv" -> "My Playlist"
                let playlistName = filename.replace('.csv', '').replace(/^.*[\\\/]/, '');
                
                // Check if CSV has a Playlist column
                const hasPlaylistColumn = rows.length > 0 && (rows[0]['Playlist'] || rows[0]['Playlist Title']);
                
                if (hasPlaylistColumn) {
                    // Group by playlist name
                    const playlistGroups = {};
                    
                    for (const row of rows) {
                        const pName = row['Playlist'] || row['Playlist Title'] || playlistName;
                        const title = row['Title'] || row['Song'] || row['Name'] || row[0];
                        const artist = row['Artist'] || row['Channel'] || row[1];
                        
                        if (title && title !== 'Title' && title !== 'Song' && title !== 'Name') {
                            if (!playlistGroups[pName]) {
                                playlistGroups[pName] = {
                                    name: pName,
                                    description: 'Imported from YouTube Music',
                                    videos: []
                                };
                            }
                            playlistGroups[pName].videos.push({
                                title: title.trim(),
                                artist: artist ? artist.trim() : ''
                            });
                        }
                    }
                    
                    playlists.push(...Object.values(playlistGroups));
                } else {
                    // Single playlist file
                    const playlistData = {
                        name: playlistName,
                        description: 'Imported from YouTube Music',
                        videos: []
                    };
                    
                    for (const row of rows) {
                        const title = row['Title'] || row['Song'] || row['Name'] || row[0];
                        const artist = row['Artist'] || row['Channel'] || row[1];
                        
                        if (title && title !== 'Title' && title !== 'Song' && title !== 'Name') {
                            playlistData.videos.push({
                                title: title.trim(),
                                artist: artist ? artist.trim() : ''
                            });
                        }
                    }
                    
                    if (playlistData.videos.length > 0) {
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
     * Parse CSV content into array of objects
     * Handles quoted fields and escapes properly
     */
    parseCSV(content) {
        const rows = [];
        const lines = content.split(/\r?\n/);
        
        if (lines.length === 0) return rows;
        
        // Parse header row
        const headers = this.parseCSVLine(lines[0]);
        
        // Parse data rows
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = this.parseCSVLine(line);
            const row = {};
            
            // Create object with headers as keys
            for (let j = 0; j < headers.length; j++) {
                row[headers[j]] = values[j] || '';
                // Also store by index for fallback
                row[j] = values[j] || '';
            }
            
            rows.push(row);
        }
        
        return rows;
    }

    /**
     * Parse a single CSV line handling quoted fields
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (inQuotes) {
                if (char === '"') {
                    if (nextChar === '"') {
                        // Escaped quote
                        current += '"';
                        i++;
                    } else {
                        // End of quoted field
                        inQuotes = false;
                    }
                } else {
                    current += char;
                }
            } else {
                if (char === '"') {
                    inQuotes = true;
                } else if (char === ',') {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
        }
        
        result.push(current.trim());
        return result;
    }

    /**
     * Search for a track on the streaming service by title/artist
     * Uses multiple search strategies for better matching
     */
    async searchTrack(title, artist = '') {
        if (!title) return null;
        
        // Clean up title - remove common YouTube suffixes and noise
        let cleanTitle = title
            .replace(/\s*\(Official.*?\)/gi, '')
            .replace(/\s*\[Official.*?\]/gi, '')
            .replace(/\s*\(Lyric.*?\)/gi, '')
            .replace(/\s*\[Lyric.*?\]/gi, '')
            .replace(/\s*\(Audio.*?\)/gi, '')
            .replace(/\s*\[Audio.*?\]/gi, '')
            .replace(/\s*\(Music Video.*?\)/gi, '')
            .replace(/\s*\[Music Video.*?\]/gi, '')
            .replace(/\s*\(Visualizer.*?\)/gi, '')
            .replace(/\s*\[Visualizer.*?\]/gi, '')
            .replace(/\s*\(HD.*?\)/gi, '')
            .replace(/\s*\[HD.*?\]/gi, '')
            .replace(/\s*\(HQ.*?\)/gi, '')
            .replace(/\s*\[HQ.*?\]/gi, '')
            .replace(/\s*-\s*Topic$/i, '')
            .replace(/\s*\|\s*.*$/i, '') // Remove everything after |
            .replace(/\s*\/\/\s*.*$/i, '') // Remove everything after //
            .trim();
        
        // Clean up artist name
        let cleanArtist = (artist || '')
            .replace(/\s*-\s*Topic$/i, '')
            .replace(/\s*VEVO$/i, '')
            .replace(/\s*Official$/i, '')
            .trim();
        
        // Try multiple search strategies
        const searchQueries = [];
        
        // Strategy 1: Artist + Title (most reliable)
        if (cleanArtist && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())) {
            searchQueries.push(`${cleanArtist} ${cleanTitle}`);
        }
        
        // Strategy 2: Just the title (if it already contains artist)
        searchQueries.push(cleanTitle);
        
        // Strategy 3: Title with first part only (before any dash or parenthesis)
        const simplifiedTitle = cleanTitle.split(/\s*[-–—]\s*/)[0].trim();
        if (simplifiedTitle !== cleanTitle && cleanArtist) {
            searchQueries.push(`${cleanArtist} ${simplifiedTitle}`);
        }
        
        // Remove duplicates
        const uniqueQueries = [...new Set(searchQueries)];
        
        for (const query of uniqueQueries) {
            if (!query || query.length < 2) continue;
            
            try {
                const results = await this.api.searchTracks(query, { limit: 10 });
                
                if (results.items && results.items.length > 0) {
                    // Try to find best match based on title/artist similarity
                    const bestMatch = this.findBestMatch(results.items, cleanTitle, cleanArtist);
                    if (bestMatch) {
                        return bestMatch;
                    }
                    // Fallback to first result
                    return results.items[0];
                }
            } catch (error) {
                console.warn('Search failed for:', query, error.message);
            }
            
            // Small delay between retries
            await this.delay(50);
        }
        
        return null;
    }

    /**
     * Find the best matching track from search results
     */
    findBestMatch(tracks, targetTitle, targetArtist) {
        if (!tracks || tracks.length === 0) return null;
        
        const normalizeStr = (str) => (str || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
        const normTitle = normalizeStr(targetTitle);
        const normArtist = normalizeStr(targetArtist);
        
        let bestScore = 0;
        let bestTrack = null;
        
        for (const track of tracks) {
            let score = 0;
            
            const trackTitle = normalizeStr(track.title);
            const trackArtist = normalizeStr(
                track.artist?.name || track.artists?.[0]?.name || ''
            );
            
            // Exact title match
            if (trackTitle === normTitle) {
                score += 50;
            } else if (trackTitle.includes(normTitle) || normTitle.includes(trackTitle)) {
                score += 30;
            }
            
            // Artist match
            if (normArtist && trackArtist) {
                if (trackArtist === normArtist) {
                    score += 40;
                } else if (trackArtist.includes(normArtist) || normArtist.includes(trackArtist)) {
                    score += 20;
                }
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestTrack = track;
            }
        }
        
        // Only return if we have a reasonable match (lowered threshold for better coverage)
        return bestScore >= 20 ? bestTrack : null;
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
                // Get artist from item - CSV data has it directly, JSON might have subtitles
                let artist = item.artist || '';
                if (!artist && item.subtitles && item.subtitles.length > 0) {
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
                    } else if (type === 'history') {
                        // Add to watch/listen history
                        await db.addToHistory(track);
                        results.imported++;
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
                const track = await this.searchTrack(video.title, video.artist || '');
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
                // createPlaylist signature: (name, tracks = [], cover = '', description = '')
                const newPlaylist = await db.createPlaylist(
                    playlistData.name,
                    [], // Start with empty tracks, we'll add them one by one
                    '', // No cover
                    playlistData.description || 'Imported from YouTube Music'
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
        
        if (lower.includes('watch-history') || lower.includes('watch_history') || lower.includes('history')) {
            return 'history';
        }
        // "liked" songs, "library songs", "songs", "tracks"
        if (lower.includes('liked') || lower.includes('like') || 
            lower.includes('songs') || lower.includes('library') || lower.includes('tracks')) {
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
                        // Import history items to the database
                        results.history = await this.importItems(items, 'history');
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
            html += `<p>📜 History: ${results.history.imported} imported, ${results.history.failed} not found${results.history.skipped ? `, ${results.history.skipped} skipped` : ''}</p>`;
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
    
    // Initialize Spotify Import
    initializeSpotifyImport(api);
    
    // Initialize Apple Music Import
    initializeAppleMusicImport(api);
}

/**
 * Initialize Spotify Import UI
 */
function initializeSpotifyImport(api) {
    const fileInput = document.getElementById('spotify-file-input');
    const selectBtn = document.getElementById('spotify-select-files-btn');
    const filesSelectedText = document.getElementById('spotify-files-selected');
    const startBtn = document.getElementById('spotify-start-import-btn');
    const statusText = document.getElementById('spotify-import-status');
    const progressContainer = document.getElementById('spotify-progress-container');
    const progressFill = document.getElementById('spotify-progress-fill');
    const progressText = document.getElementById('spotify-progress-text');
    const resultsContainer = document.getElementById('spotify-results');
    
    if (!selectBtn || !fileInput) return;
    
    let importer = new TakeoutImporter(api);
    
    selectBtn.addEventListener('click', () => fileInput.click());
    
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
            progressText.textContent = `Importing playlist "${data.playlistName || 'Spotify'}": ${data.current}/${data.total}`;
        };
        
        try {
            const results = { playlists: [] };
            
            for (const file of importer.files) {
                const content = await importer.readFile(file);
                // Spotify CSV has: Track Name, Artist Name(s), Album Name, etc.
                const playlists = await parseSpotifyCSV(importer, content, file.name);
                
                for (const playlist of playlists) {
                    const playlistResult = await importer.importPlaylist(playlist);
                    results.playlists.push(playlistResult);
                }
            }
            
            progressContainer.style.display = 'none';
            displaySpotifyResults(results, resultsContainer);
            statusText.textContent = 'Import complete!';
            selectBtn.disabled = false;
        } catch (error) {
            console.error('Spotify import failed:', error);
            statusText.textContent = 'Import failed: ' + error.message;
            progressContainer.style.display = 'none';
            selectBtn.disabled = false;
        }
    });
}

/**
 * Parse Spotify CSV export
 */
async function parseSpotifyCSV(importer, content, filename) {
    const playlists = [];
    const rows = importer.parseCSV(content);
    
    // Extract playlist name from filename
    let playlistName = filename.replace('.csv', '').replace(/^.*[\\\/]/, '');
    
    const playlistData = {
        name: playlistName,
        description: 'Imported from Spotify',
        videos: []
    };
    
    for (const row of rows) {
        // Spotify CSV columns: Track Name, Artist Name(s), Album Name, Track URI, etc.
        const title = row['Track Name'] || row['Song Name'] || row['Name'] || row[0];
        const artist = row['Artist Name(s)'] || row['Artist'] || row[1];
        
        if (title && title !== 'Track Name' && title !== 'Song Name') {
            playlistData.videos.push({
                title: title.trim(),
                artist: artist ? artist.trim() : ''
            });
        }
    }
    
    if (playlistData.videos.length > 0) {
        playlists.push(playlistData);
    }
    
    return playlists;
}

function displaySpotifyResults(results, container) {
    container.style.display = 'block';
    
    let html = '<h4 style="margin-bottom: 0.5rem;">Import Results</h4>';
    
    if (results.playlists.length > 0) {
        html += `<ul style="margin-left: 1rem;">`;
        for (const playlist of results.playlists) {
            html += `<li>🎵 ${playlist.name}: ${playlist.imported}/${playlist.total} tracks imported</li>`;
        }
        html += `</ul>`;
    } else {
        html += `<p>No playlists found in the selected files.</p>`;
    }
    
    container.innerHTML = html;
}

/**
 * Initialize Apple Music Import UI
 */
function initializeAppleMusicImport(api) {
    const fileInput = document.getElementById('apple-file-input');
    const selectBtn = document.getElementById('apple-select-files-btn');
    const filesSelectedText = document.getElementById('apple-files-selected');
    const startBtn = document.getElementById('apple-start-import-btn');
    const statusText = document.getElementById('apple-import-status');
    const progressContainer = document.getElementById('apple-progress-container');
    const progressFill = document.getElementById('apple-progress-fill');
    const progressText = document.getElementById('apple-progress-text');
    const resultsContainer = document.getElementById('apple-results');
    
    if (!selectBtn || !fileInput) return;
    
    let importer = new TakeoutImporter(api);
    
    selectBtn.addEventListener('click', () => fileInput.click());
    
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
            progressText.textContent = `Importing: ${data.current}/${data.total}`;
        };
        
        try {
            const results = { likes: null, playlists: [] };
            
            for (const file of importer.files) {
                const content = await importer.readFile(file);
                const filename = file.name.toLowerCase();
                
                if (filename.endsWith('.xml')) {
                    // Apple Music XML Library format
                    const items = await parseAppleMusicXML(content);
                    if (items.length > 0) {
                        results.likes = await importer.importItems(items, 'likes');
                    }
                } else if (filename.endsWith('.csv') || filename.endsWith('.txt')) {
                    // CSV/TSV format
                    const playlists = await parseAppleMusicCSV(importer, content, file.name);
                    for (const playlist of playlists) {
                        const playlistResult = await importer.importPlaylist(playlist);
                        results.playlists.push(playlistResult);
                    }
                }
            }
            
            progressContainer.style.display = 'none';
            displayAppleResults(results, resultsContainer);
            statusText.textContent = 'Import complete!';
            selectBtn.disabled = false;
        } catch (error) {
            console.error('Apple Music import failed:', error);
            statusText.textContent = 'Import failed: ' + error.message;
            progressContainer.style.display = 'none';
            selectBtn.disabled = false;
        }
    });
}

/**
 * Parse Apple Music XML Library (iTunes Library.xml format)
 */
async function parseAppleMusicXML(content) {
    const items = [];
    
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/xml');
        
        // Apple Music/iTunes Library.xml is a plist format
        // Structure: plist > dict > dict (key:Tracks) > dict > dict (each track)
        const rootDict = doc.querySelector('plist > dict');
        if (!rootDict) {
            console.warn('Not a valid iTunes/Apple Music plist format');
            return items;
        }
        
        // Find the "Tracks" dict
        const keys = rootDict.querySelectorAll(':scope > key');
        let tracksDict = null;
        
        for (const key of keys) {
            if (key.textContent === 'Tracks') {
                tracksDict = key.nextElementSibling;
                break;
            }
        }
        
        if (!tracksDict || tracksDict.tagName !== 'dict') {
            console.warn('Could not find Tracks dictionary in plist');
            return items;
        }
        
        // Parse each track in the Tracks dict
        const trackKeys = tracksDict.querySelectorAll(':scope > key');
        
        for (const trackKey of trackKeys) {
            const trackDict = trackKey.nextElementSibling;
            if (!trackDict || trackDict.tagName !== 'dict') continue;
            
            const trackData = {};
            const propKeys = trackDict.querySelectorAll(':scope > key');
            
            for (const propKey of propKeys) {
                const value = propKey.nextElementSibling;
                if (value && (value.tagName === 'string' || value.tagName === 'integer')) {
                    trackData[propKey.textContent] = value.textContent;
                }
            }
            
            // Only add if we have Name and Artist
            if (trackData['Name'] && trackData['Artist']) {
                items.push({
                    title: trackData['Name'],
                    artist: trackData['Artist'],
                    album: trackData['Album'] || ''
                });
            }
        }
        
        console.log(`[Apple Music Import] Parsed ${items.length} tracks from XML`);
    } catch (error) {
        console.error('Failed to parse Apple Music XML:', error);
    }
    
    return items;
}

/**
 * Parse Apple Music CSV/TSV export
 * Apple Music "Plain Text" exports are actually TSV (tab-separated)
 */
async function parseAppleMusicCSV(importer, content, filename) {
    const playlists = [];
    
    // Detect if it's TSV (tab-separated) or CSV (comma-separated)
    const firstLine = content.split(/\r?\n/)[0] || '';
    const isTSV = firstLine.includes('\t') && !firstLine.includes(',');
    
    let rows;
    if (isTSV) {
        // Parse TSV manually
        rows = [];
        const lines = content.split(/\r?\n/);
        if (lines.length > 0) {
            const headers = lines[0].split('\t').map(h => h.trim());
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const values = line.split('\t');
                const row = {};
                for (let j = 0; j < headers.length; j++) {
                    row[headers[j]] = values[j] || '';
                    row[j] = values[j] || '';
                }
                rows.push(row);
            }
        }
    } else {
        rows = importer.parseCSV(content);
    }
    
    let playlistName = filename.replace(/\.(csv|txt)$/i, '').replace(/^.*[\\\/]/, '');
    
    const playlistData = {
        name: playlistName,
        description: 'Imported from Apple Music',
        videos: []
    };
    
    for (const row of rows) {
        // Apple Music exports columns: Name, Artist, Composer, Album, Grouping, etc.
        const title = row['Name'] || row['Song'] || row['Title'] || row[0];
        const artist = row['Artist'] || row[1];
        
        if (title && title !== 'Name' && title !== 'Song' && title !== 'Title') {
            playlistData.videos.push({
                title: title.trim(),
                artist: artist ? artist.trim() : ''
            });
        }
    }
    
    if (playlistData.videos.length > 0) {
        playlists.push(playlistData);
        console.log(`[Apple Music Import] Parsed ${playlistData.videos.length} tracks from ${filename}`);
    }
    
    return playlists;
}

function displayAppleResults(results, container) {
    container.style.display = 'block';
    
    let html = '<h4 style="margin-bottom: 0.5rem;">Import Results</h4>';
    
    if (results.likes) {
        html += `<p>🎵 Library: ${results.likes.imported} imported, ${results.likes.failed} not found</p>`;
    }
    
    if (results.playlists.length > 0) {
        html += `<ul style="margin-left: 1rem;">`;
        for (const playlist of results.playlists) {
            html += `<li>📁 ${playlist.name}: ${playlist.imported}/${playlist.total} tracks imported</li>`;
        }
        html += `</ul>`;
    }
    
    if (!results.likes && results.playlists.length === 0) {
        html += `<p>No data found in the selected files.</p>`;
    }
    
    container.innerHTML = html;
}
