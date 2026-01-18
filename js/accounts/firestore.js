import { db as firestoreDb } from './config.js';
import { db as localDb } from '../db.js';
import { authManager } from './auth.js';
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    deleteField,
} from 'firebase/firestore';

const PUBLIC_COLLECTION = 'public_playlists';

export const syncManager = {
    _isSyncing: false,

    _getUserRef(uid) {
        return doc(firestoreDb, 'users', uid);
    },

    async getUserData() {
        const user = authManager.user;
        if (!user) return null;

        try {
            const userRef = this._getUserRef(user.uid);
            const snap = await getDoc(userRef);

            if (snap.exists()) {
                return snap.data();
            } else {
                // Initialize user doc if missing
                const initialData = { library: {}, history: [], user_playlists: {} };
                await setDoc(userRef, initialData);
                return initialData;
            }
        } catch (error) {
            console.error('Failed to get user data from Firestore:', error);
            return null;
        }
    },

    async syncLibraryItem(type, item, added) {
        const user = authManager.user;
        if (!user) return;

        const pluralType = type === 'mix' ? 'mixes' : `${type}s`;
        const key = type === 'playlist' ? item.uuid : item.id;
        
        // Ensure library structure exists (optional check, but updateDoc should handle nested dotted paths if parent exists? No, parent map must exist.)
        // But assuming getUserData initialized 'library: {}', it's fine.
        // However, 'library.tracks' might not exist.
        // updateDoc('library.tracks.123', val) will fail if library.tracks is undefined?
        // Yes, Firestore requires the map path to exist.
        // So safe strategy: use setDoc with merge for deep updates OR ensure structure.
        // Actually, easiest is read-modify-write for the specific type collection if needed, 
        // OR leverage existing structure assumption.
        // PocketBase implementation read entire library JSON.
        // Here, let's try reading the type sub-object first? 
        // OR: just use dot notation and hope? No.
        
        // Better approach: Read modify write whole library? Expensive.
        // Alternative: setDoc(ref, { library: { [pluralType]: { [key]: val } } }, { merge: true })
        // This handles missing intermediates!
        
        const userRef = this._getUserRef(user.uid);
        
        try {
            if (added) {
                const val = this._minifyItem(type, item);
                await setDoc(userRef, { 
                    library: { 
                        [pluralType]: { 
                            [key]: val 
                        } 
                    } 
                }, { merge: true });
            } else {
                // For deletion, updateDoc with deleteField needs exact path.
                const fieldPath = `library.${pluralType}.${key}`;
                await updateDoc(userRef, { [fieldPath]: deleteField() });
            }
        } catch (error) {
             console.error(`Failed to sync ${type} item:`, error);
        }
    },
    
    async syncHistoryItem(historyEntry) {
        const user = authManager.user;
        if (!user) return;

        try {
            const userRef = this._getUserRef(user.uid);
            const snap = await getDoc(userRef);
            let history = [];
            if (snap.exists()) {
                history = snap.data().history || [];
            }
            
            const newHistory = [historyEntry, ...history].slice(0, 100);
            await updateDoc(userRef, { history: newHistory });
        } catch (error) {
            console.error('Failed to sync history:', error);
        }
    },

    async syncUserPlaylist(playlist, action) {
        const user = authManager.user;
        if (!user) return;

        const userRef = this._getUserRef(user.uid);
        
        try {
            if (action === 'delete') {
                const fieldPath = `user_playlists.${playlist.id}`;
                await updateDoc(userRef, { [fieldPath]: deleteField() });
            } else {
                const data = {
                    id: playlist.id,
                    name: playlist.name,
                    cover: playlist.cover || null,
                    tracks: playlist.tracks ? playlist.tracks.map((t) => this._minifyItem('track', t)) : [],
                    createdAt: playlist.createdAt || Date.now(),
                    updatedAt: playlist.updatedAt || Date.now(),
                    numberOfTracks: playlist.tracks ? playlist.tracks.length : 0,
                    images: playlist.images || [],
                    isPublic: playlist.isPublic || false,
                };
                
                await setDoc(userRef, { 
                    user_playlists: { 
                        [playlist.id]: data 
                    } 
                }, { merge: true });
            }
        } catch (error) {
            console.error('Failed to sync user playlist:', error);
        }
    },

    async getPublicPlaylist(uuid) {
        try {
            const docRef = doc(firestoreDb, PUBLIC_COLLECTION, uuid);
            const snap = await getDoc(docRef);

            if (!snap.exists()) return null;

            const record = snap.data();
            
            // Normalize fields (matches pocketbase return structure)
            return {
                ...record,
                id: record.uuid, 
                // ... logic from pocketbase.js but adapted
                name: record.title || record.name || 'Untitled Playlist',
                tracks: record.tracks || [],
                numberOfTracks: (record.tracks || []).length,
                type: 'user-playlist',
                isPublic: true,
                user: record.user || { name: 'Community Playlist' },
            };
        } catch (error) {
            console.error('Failed to fetch public playlist:', error);
            return null; // or throw
        }
    },

    async publishPlaylist(playlist) {
        if (!playlist || !playlist.id) return;
        const uid = authManager.user?.uid;
        if (!uid) return;

        const data = {
            uuid: playlist.id,
            uid: uid,
            title: playlist.name,
            name: playlist.name,
            playlist_name: playlist.name,
            image: playlist.cover,
            cover: playlist.cover,
            tracks: playlist.tracks, // hopefully simplified?
            isPublic: true,
            updatedAt: Date.now()
        };

        try {
            const docRef = doc(firestoreDb, PUBLIC_COLLECTION, playlist.id);
            await setDoc(docRef, data);
        } catch (error) {
            console.error('Failed to publish playlist:', error);
        }
    },

    async unpublishPlaylist(uuid) {
        const uid = authManager.user?.uid;
        if (!uid) return;

        try {
            const docRef = doc(firestoreDb, PUBLIC_COLLECTION, uuid);
            await deleteDoc(docRef);
        } catch (error) {
            console.error('Failed to unpublish playlist:', error);
        }
    },

    async clearCloudData() {
        const user = authManager.user;
        if (!user) return;
        
        if (confirm('Are you sure you want to delete all cloud data? This cannot be undone.')) {
            try {
                const userRef = this._getUserRef(user.uid);
                await deleteDoc(userRef);
                alert('Cloud data cleared successfully.');
            } catch (error) {
                console.error('Failed to clear cloud data:', error);
                alert('Failed to clear cloud data.');
            }
        }
    },

    async onAuthStateChanged(user) {
        if (user) {
            if (this._isSyncing) return;
            this._isSyncing = true;

            try {
                const data = await this.getUserData();
                if (data) {
                    const convertedData = {
                        favorites_tracks: data.library?.tracks ? Object.values(data.library.tracks) : [],
                        favorites_albums: data.library?.albums ? Object.values(data.library.albums) : [],
                        favorites_artists: data.library?.artists ? Object.values(data.library.artists) : [],
                        favorites_playlists: data.library?.playlists ? Object.values(data.library.playlists) : [],
                        favorites_mixes: data.library?.mixes ? Object.values(data.library.mixes) : [],
                        history_tracks: data.history || [],
                        user_playlists: data.user_playlists ? Object.values(data.user_playlists) : [],
                    };

                    await localDb.importData(convertedData);
                    
                    // Delay slightly to ensure DB persists
                    await new Promise((resolve) => setTimeout(resolve, 300));

                    window.dispatchEvent(new CustomEvent('library-changed'));
                    window.dispatchEvent(new CustomEvent('history-changed'));
                    // window.dispatchEvent(new HashChangeEvent('hashchange')); // Only if needed
                }
            } catch (error) {
                console.error('Error during Firestore sync:', error);
            } finally {
                this._isSyncing = false;
            }
        } else {
             this._isSyncing = false;
        }
    },

    _minifyItem(type, item) {
        if (!item) return item;

        const base = {
            id: item.id,
            addedAt: item.addedAt || Date.now(),
        };

        if (type === 'track') {
            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album ? {
                        id: item.album.id,
                        title: item.album.title || null,
                        cover: item.album.cover || null
                } : null,
                // Add rest of properties if needed, but this is a decent subset
                version: item.version || null
            };
        }
        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                artist: item.artist || (item.artists && item.artists[0]) || null
            };
        }
        if (type === 'artist') {
             return {
                 ...base,
                 name: item.name,
                 picture: item.picture || item.image
             };
        }
        if (type === 'playlist') {
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || Date.now(),
                title: item.title || item.name,
                image: item.image || item.cover,
                user: item.user
            };
        }
        if (type === 'mix') {
            return {
                 id: item.id,
                 addedAt: item.addedAt || Date.now(),
                 title: item.title,
                 mixType: item.mixType,
                 cover: item.cover
            };
        }
        return item;
    }
};

// Bind auth listener
authManager.onAuthStateChanged(syncManager.onAuthStateChanged.bind(syncManager));
