# Loop Music

A minimalist, web-based music streaming application built with modern web technologies. Stream high-quality music, manage your library, create playlists, and enjoy a clean, distraction-free listening experience.

![Loop Music](assets/loop-light.png)

## Features

### 🎵 Core Streaming Features

- **High-Quality Audio Streaming** - Lossless audio support with adaptive bitrate streaming
- **Offline Downloads** - Download albums, playlists, and individual tracks for offline listening
- **Smart Shuffle** - AI-powered shuffle recommendations (requires Groq API)
- **Queue Management** - Advanced queue controls with play next, add to queue, and queue editing

### 🎛️ Playback Controls

- **Chromecast & AirPlay Support** - Cast music to compatible devices
- **Keyboard Shortcuts** - Full keyboard navigation support
- **Sleep Timer** - Set automatic playback stop after specified time
- **Crossfade** - Smooth transitions between tracks
- **Repeat Modes** - Track, album, or playlist repeat options

### 📚 Library Management

- **Personal Library** - Organize your music collection
- **Custom Playlists** - Create, edit, and share playlists
- **Import/Export** - Import playlists from Spotify, Apple Music (CSV format)
- **Liked Songs** - Heart tracks and build your favorites collection
- **Recently Played** - Quick access to your listening history

### 🔍 Discovery & Search

- **Advanced Search** - Search across tracks, albums, artists, and playlists
- **Recommendations** - Personalized music discovery
- **Browse by Categories** - Explore music by genres, moods, and eras
- **Artist/Album Pages** - Detailed artist and album information

### 🎨 User Experience

- **Progressive Web App (PWA)** - Install as a native app on mobile and desktop
- **Dark/Light Themes** - Automatic theme switching with manual override
- **Responsive Design** - Optimized for mobile, tablet, and desktop
- **Touch Gestures** - Swipe controls on mobile devices
- **Glass Morphism UI** - Modern, translucent interface design

### 🔗 Integrations

- **Last.fm Scrobbling** - Track your listening history and discover new music
- **Lyrics Display** - Synchronized lyrics support
- **Social Features** - Share playlists and music discoveries
- **Firebase Backend** - Cloud sync and user accounts

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Build Tool**: Vite
- **Backend**: Firebase (Authentication, Firestore, Storage)
- **Streaming**: DASH.js for adaptive bitrate streaming
- **PWA**: Vite PWA plugin for offline support
- **Audio**: Web Audio API with custom player controls

## Live Demo

Try Loop Music live at: **[https://playonloop.vercel.app/](https://playonloop.vercel.app/)**

## Prerequisites

- Node.js 16+
- npm or yarn
- Firebase project (for cloud features)
- Last.fm API key (optional, for scrobbling)
- Groq API key (optional, for AI recommendations)

## Installation

1. **Clone the repository**

    ```bash
    git clone https://github.com/iamtheretronerd/loop.git
    cd loop
    ```

2. **Install dependencies**

    ```bash
    npm install
    ```

3. **Configure environment variables**

    ```bash
    cp .env.example .env
    ```

    Edit `.env` and add your API keys:

    ```env
    VITE_FIREBASE_API_KEY=your_api_key_here
    VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_project_id.firebasestorage.app
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    VITE_FIREBASE_APP_ID=your_app_id

    # Optional
    VITE_LASTFM_API_KEY=your_lastfm_api_key
    VITE_LASTFM_API_SECRET=your_lastfm_api_secret
    VITE_GROQ_API_KEY=your_groq_api_key
    ```

4. **Start development server**

    ```bash
    npm run dev
    ```

5. **Build for production**
    ```bash
    npm run build
    npm run preview
    ```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run lint:js` - Lint JavaScript files
- `npm run lint:css` - Lint CSS files
- `npm run lint:html` - Lint HTML files
- `npm run format` - Format code with Prettier

## Project Structure

```
loop/
├── index.html              # Main HTML file
├── styles.css              # Main stylesheet
├── profile.css             # Profile page styles
├── js/                     # JavaScript modules
│   ├── app.js             # Main application entry point
│   ├── api.js             # API client for music streaming
│   ├── player.js          # Audio player controls
│   ├── ui.js              # UI rendering components
│   ├── router.js          # Client-side routing
│   ├── storage.js         # Local storage management
│   ├── db.js              # IndexedDB wrapper
│   ├── accounts/          # User account management
│   └── ...
├── assets/                 # Static assets (images, icons)
├── public/                 # Public assets for PWA
├── package.json           # Project configuration
├── vite.config.js         # Vite build configuration
├── manifest.json          # PWA manifest
└── .env.example          # Environment variables template
```

## Browser Support

- Chrome 88+
- Firefox 85+
- Safari 14+
- Edge 88+

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature-name`
5. Submit a pull request

## Keyboard Shortcuts

| Shortcut  | Action            |
| --------- | ----------------- |
| Space     | Play/Pause        |
| →         | Seek forward 10s  |
| ←         | Seek backward 10s |
| Shift + → | Next track        |
| Shift + ← | Previous track    |
| ↑         | Volume up         |
| ↓         | Volume down       |
| M         | Mute/Unmute       |
| S         | Toggle shuffle    |
| R         | Toggle repeat     |
| Q         | Open queue        |
| L         | Toggle lyrics     |
| /         | Focus search      |
| Esc       | Close modals      |

## API Endpoints

The application connects to various music streaming APIs. For self-hosting setup, see the [self-hosted database guide](https://github.com/iamtheretronerd/loop/blob/main/self-hosted-database.md).

## License

MIT License - see the repository license file for details.

## Acknowledgments

- Built with [Vite](https://vitejs.dev/)
- Audio streaming powered by [DASH.js](https://github.com/Dash-Industry-Forum/dash.js)
- Icons from [Lucide](https://lucide.dev/)
- Fonts from [Google Fonts](https://fonts.google.com/)

## Support

- [GitHub Issues](https://github.com/iamtheretronerd/loop/issues)
- [GitHub Discussions](https://github.com/iamtheretronerd/loop/discussions)

---

**Loop Music** - Your music, your way.
