[English](README_en.md) | [中文](README.md)
# GMC-Enhance

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kibmlbbigjmpmfjpcjhlmimehchnamgi?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/kibmlbbigjmpmfjpcjhlmimehchnamgi)

Unified Control · Powerful Shortcuts · Independent Tab Sessions

Global Media Control (GMC)-Enhance is a Chrome extension that supercharges Chrome's built‑in Global Media Control. It delivers true **unified control** across all your media, **global shortcuts** for instant actions, and **independent tab sessions** so each tab keeps its own playback, speed, and effect state without interference.

> Release history: see [RELEASE.md](RELEASE.md)

![Logo](docs/imgs/banner.png)



## Table of Contents

1. [Features](#features)
2. [User Guide](#user-guide)
   - [Basic Playback Control](#1-basic-playback-control)
   - [Audio Effects Control](#2-audio-effects-control)
   - [Shortcuts](#3-shortcuts)
3. [Installation](#installation)
4. [Contributing](#contributing)
5. [License](#license)
6. [Permissions](#permissions)



## Features

GMC-Enhance offers:

- **Unified Media Control** – One toolbar entry for all audible media.
- **Playback & Seeking** – Play / pause / backward / forward (configurable step).
- **Speed Management** – Increment/decrement, reset, preset cycling + per‑tab speed badge (hidden at 1×).
- **Global Shortcuts** – Seek, speed, volume, mute, target selection.
- **Independent Tab Sessions** – Each tab keeps its own state (speed / volume / EQ).
- **Volume & Mute** – Fine‑grained steps and quick mute toggle.
- **Equalizer (10-Band)** – Core frequency shaping with presets.
- **Floating HUD** – Instant feedback on shortcut actions (cross‑tab aware).

> Full cumulative change log: see [RELEASE.md](RELEASE.md).



## User Guide

### 1. Basic Playback Control

Control video playback directly from the toolbar or using keyboard shortcuts. Supported actions include play, pause, skip backward/forward, and speed adjustments.
![Popup Page](docs/imgs/popup-page.png)

### 2. Audio Effects Control

Enhance your listening experience with advanced audio controls. For example:

- Reduce vocal volume by lowering the 1kHz–4kHz frequency range.
- Boost bass by increasing low-frequency bands.

These adjustments are particularly useful for live streams or videos with unbalanced audio.

Features include:
- 10-Band Equalizer: Adjust frequency bands from 31Hz to 16kHz.
- Preset Management: Save, load, and delete custom EQ presets.
- Real-Time Spectrum: Visualize the current audio spectrum to help you see the effect of your adjustments.
![EQ Page](docs/imgs/eq-function.png)

### 3. Shortcuts

GMC-Enhance supports the following keyboard shortcuts for fast, interruption‑free media control. Custom shortcuts can be set (right-click the image and click "Options").

| Action                  | Shortcut            | Description                                                                                                      |
|------------------------|---------------------|------------------------------------------------------------------------------------------------------------------|
| Select Controlled Video | `Alt + Shift + V`   | Select which video to control.                                                                                   |
| Play/Pause              | `Alt + Shift + K`   | Toggle play/pause for the selected video.<br>If you are on a page with a video, this shortcut controls that video by default unless you have selected another video using `Alt + Shift + V`. |
| Backward                | `Alt + Shift + J`   | Skip backward (default: -15 seconds).<br>If you are on a page with a video, this shortcut controls that video by default unless you have selected another video using `Alt + Shift + V`.      |
| Forward                 | `Alt + Shift + L`   | Skip forward (default: +15 seconds).<br>If you are on a page with a video, this shortcut controls that video by default unless you have selected another video using `Alt + Shift + V`.       |
| Speed Up                | `Alt + Shift + O`   | Increase playback speed (default: +0.5x).                                                                        |
| Speed Down              | `Alt + Shift + U`   | Decrease playback speed (default: -0.5x).                                                                        |
| Reset Speed             | `Alt + Shift + I`   | Reset playback speed to normal (default: 1x).                                                                    |
| Set Speed               | `Alt + Shift + P`   | Cycle through preset playback speeds.                                                                            |
| Volume Up               | `Alt + Shift + >`   | Increase volume (default: +10%).                                                                                 |
| Volume Down             | `Alt + Shift + <`   | Decrease volume (default: -10%).                                                                                 |
| Mute/Unmute             | `Alt + Shift + M`   | Toggle mute/unmute.                                                                                              |

![Floating Video Control](docs/imgs/video_float_card.gif)

**Tip**: By mapping shortcuts to a keyboard knob, you can achieve precise control over video progress, which was the inspiration behind this extension.

### 4. Icon Badges & Visual Cues

- Red-tinted icon: EQ has non-zero gain adjustments.
- Orange badge: Tab playback speed (hidden at 1×).
- Combined: Indicates both “modified EQ” and “non‑standard speed”.

### 5. FAQ (Quick Answers)

| Question | Answer |
|----------|--------|
| HUD sometimes stops updating? | When controlling a media element in a non-active tab, background polling (200ms) drives updates; active tab uses frame-driven updates. |
| Live stream seeking ignored? | Live sources suppress seek jumps and show informational state instead. |
| Speed badge missing? | Only shown when playback rate ≠ 1×; returning to 1× clears it. |
| Old preset lacked Q? | A default Q is applied; re-save to embed Q. |

## Installation

### Method 1: Install from Chrome Web Store

- Visit the [Chrome Web Store GMC-Enhance page](https://chromewebstore.google.com/detail/kibmlbbigjmpmfjpcjhlmimehchnamgi?utm_source=item-share-cb).
- Click “Add to Chrome” and follow the prompts to complete installation.

### Method 2: Install via ZIP Package (for local use or if the store is inaccessible)

1. Go to the [GitHub Release page](https://github.com/ZepengW/GMC-Enhance/releases) and download the latest ZIP package.
2. Extract the ZIP file to a local folder.
3. Open Chrome and navigate to `chrome://extensions/`.
4. Enable “Developer mode” in the top right corner.
5. Click “Load unpacked” and select the extracted folder.
6. GMC-Enhance is now installed and ready to use.

## Contributing

Contributions are welcome! If you'd like to contribute to GMC-Enhance, please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes and submit a pull request.

For major changes, please open an issue first to discuss what you would like to change.



## License

This project is licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html). You are free to use, modify, and distribute this software under the terms of the GPL-3.0 license, which ensures that derivative works remain open source.



## Permissions

GMC-Enhance requests the minimum permissions required for its features:

- `activeTab`: Required to interact with the current tab when the user invokes the extension UI and for capturing the visible tab for screenshots.
- `tabs`: Needed to enumerate tabs and message them for media info/control.
- `storage`: Saves preferences like seek/speed steps, EQ presets, and volume step.
