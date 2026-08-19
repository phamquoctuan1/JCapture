# ⚡ JCapture (Jits Capture)

<div align="center">

![JCapture Banner](https://img.shields.io/badge/JCapture-v0.1.0-FFDE2A?style=for-the-badge&logo=appveyor&logoColor=black)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011-0078D4?style=for-the-badge&logo=windows&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?style=for-the-badge&logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-1.80+-orange?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**A blazing-fast, ultra-sharp, lightweight (<40MB RAM) screenshot capture & annotation application for Windows.**  
Built with **Tauri v2**, **Rust Win32 Per-Monitor DPI V2 GDI Engine**, and **React 19**.

[✨ Features](#-key-features) • [🚀 Quick Start](#-quick-start) • [⌨️ Shortcuts](#️-keyboard-shortcuts) • [🛠️ Build from Source](#️-build-from-source) • [🔄 Updates](#-auto-updater)

</div>

---

## 🌟 Key Features

### 🖥️ 1. Ultra-Fast & Crisp Native Screen Capture
- **Region Capture (`Alt+A` / Custom Hotkey):** Drag any box on screen with real-time coordinate dimensions and instant freeze.
- **1-Click Fullscreen Capture:** Capture entire multi-monitor desktop in <10ms.
- **100% Native Physical DPI:** Uses Windows `Per-Monitor V2 DPI Awareness` to guarantee crystal-clear, unscaled, pixel-perfect captures (zero blurriness on 125%, 150%, or 200% Windows display scaling).
- **Auto Instant Clipboard Copy:** Captured image is placed onto the Windows clipboard in less than 10 milliseconds.

---

### 🎨 2. Rich & Precise Annotation Studio
- **🔲 Text Box with Custom Border & Fill:** Drag a rectangle to place a styled text card with custom border colors (`borderColor`), background badges (`bgColor`), configurable font sizes (16–36px), and multiline support.
- **➡️ Arrow Tool:** Precision pointer arrows with customizable stroke widths and colors.
- **⬜ Shapes:** Rectangles, Ellipses, and Straight Lines with optional semi-transparent fill.
- **✏️ Freehand Pen & Doodle:** Smooth, low-latency freehand drawing.
- **🖍️ Highlighter & 🌫️ Pixelate/Blur:** Obfuscate sensitive information (passwords, tokens, personal info) or emphasize important regions.
- **🔢 Step Number Badges (①②③):** Auto-incrementing step indicators for tutorials, bug reports, and workflow docs.
- **✂️ Crop with Undo:** Drag-to-crop canvas bounds with full `Ctrl+Z` restoration support.

---

### 💧 3. Eyedropper, Color Picker & Brand Palettes
- **Brand Palette:** Features `#FFDE2A` brand yellow, vivid reds, cyans, greens, purples, and dark/light modes.
- **Eyedropper (Pipette 💧):** Click anywhere on the screen or image to sample and use any exact color HEX code.
- **Full Custom Color Picker:** Support for any HEX / RGB / HSL color.

---

### 🧩 4. Multi-Image Drag & Drop Merging
- **Recent Filmstrip Dock:** View all recent screenshots at the bottom of the editor.
- **Drag-to-Merge:** Simply drag any thumbnail from the bottom dock and drop it onto the canvas to layer and combine multiple screenshots into one composite graphic.
- **Move & Arrange:** Position, resize, and order overlay images freely.

---

### ⌨️ 5. Pro Keyboard Shortcuts & Copy/Paste
| Shortcut | Action |
| :--- | :--- |
| **`Alt+A`** (Customizable) | Trigger Region Screen Capture |
| **`Ctrl + C`** | Copy edited canvas image or selected element to clipboard |
| **`Ctrl + V`** | Paste duplicate object OR paste system clipboard image onto canvas |
| **`Ctrl + S`** | Export & Save image as PNG / JPG |
| **`Ctrl + Z`** | Unlimited Undo (including restoring cropped image) |
| **`Ctrl + Y` / `Ctrl + Shift + Z`** | Redo |
| **`Del` / `Backspace`** | Delete selected annotation or overlay object |
| **`Ctrl + Scroll` / `Ctrl + (+/-)`** | Zoom in / Zoom out canvas (25% to 400%) |
| **`Ctrl + 0`** | Reset Zoom to 100% |
| **`Esc`** | Close editor or cancel crop mode |

---

### ⚙️ 6. Customizable Global Hotkeys & GitHub Auto Updater
- **Custom Hotkey Recorder:** Set any global key combo (`Alt+A`, `Ctrl+Alt+A`, `F1-F12`, `PrintScreen`, etc.) in Preferences.
- **GitHub Release Updater:** Built-in update checker in Settings that talks directly with GitHub Releases to notify you of new versions and download them in 1 click.

---

## 🚀 Quick Start

### Download Binary
Download the latest pre-compiled installer (`.exe` / `.msi`) from the [Releases Page](https://github.com/phamquoctuan1/JCapture/releases).

1. Run `JCapture_0.1.0_x64-setup.exe` or portable `JCapture.exe`.
2. Press **`Alt+A`** to capture a region, or click **Full Screen** in the top bar.
3. Edit, annotate, and press **`Ctrl+C`** or **`Ctrl+S`**!

---

## 🛠️ Build from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Rust & Cargo](https://www.rust-lang.org/tools/install) (latest stable)
- Visual Studio C++ Build Tools (with Windows 10/11 SDK)

### Step-by-Step Build
```bash
# 1. Clone the repository
git clone https://github.com/phamquoctuan1/JCapture.git
cd JCapture

# 2. Install front-end dependencies
npm install

# 3. Run development mode (Hot-reloading)
npm run tauri dev

# 4. Build optimized standalone release (.exe and .msi)
npm run tauri build
```

The compiled binary will be located at:
`src-tauri/target/release/jcapture.exe` and `src-tauri/target/release/bundle/nsis/`

---

## 🏗️ Architecture

```
JCapture/
├── src/                          # React 19 Frontend
│   ├── components/
│   │   ├── Header.tsx            # App bar with Capture & Fullscreen triggers
│   │   ├── RecentWorkspace.tsx   # Gallery of previous captures & pins
│   │   ├── SettingsModal.tsx     # Hotkey recorder & GitHub update checker
│   │   ├── ThumbnailCard.tsx     # Card with quick delete, copy, open folder
│   │   └── editor/
│   │       └── EditorModal.tsx   # Canvas drawing engine, text box drag, zoom, image merge
│   └── types/                    # TypeScript interfaces & Annotation models
├── src-tauri/                    # Rust Backend & Native Windows APIs
│   ├── src/
│   │   ├── commands/             # Tauri IPC commands (Capture, Project, Settings, FS)
│   │   ├── native/               # Win32 GDI Per-Monitor V2, Hotkey manager, Overlay window
│   │   ├── storage/              # Embedded SQLite database (recent captures & config)
│   │   └── models/               # Data structures
│   └── Cargo.toml                # Rust dependencies & Windows API bindings
└── .github/workflows/            # GitHub Actions CI/CD (Auto-build release on tag push)
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  Crafted with ❤️ by <b>Phạm Quốc Tuấn</b>
</div>
