# Spotify Karaoke

A macOS Electron app that displays synced lyrics for whatever you're playing on Spotify — with a karaoke mode that highlights each line in real time.

![Spotify Karaoke App](https://github.com/user-attachments/assets/placeholder)

## Features

- Synced lyrics via [lrclib.net](https://lrclib.net)
- Karaoke mode with real-time line highlighting
- Album art with dynamic color theming
- Full playback controls (play/pause, skip, seek, volume, shuffle, repeat)
- Like/unlike the current track
- Resizable, draggable frameless window
- Picture-in-Picture support

## Requirements

- macOS
- [Node.js](https://nodejs.org) (v18 or later recommended)
- Spotify Premium account

## Getting Started

1. Clone the repo and install dependencies:

   ```bash
   git clone https://github.com/mvphi/spotify-karaoke.git
   cd spotify-karaoke
   npm install
   ```

2. Run the app:

   ```bash
   npm start
   ```

3. A Spotify login window will open automatically. Sign in with your Spotify Premium account.

## Spotify Access

The Client ID is already included in `main.js`, but the app is in Spotify's development mode which requires users to be manually approved.

Open an issue or contact the repo owner to be added as a test user.
