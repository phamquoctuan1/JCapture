# ROLE

You are a **Senior Windows Desktop Engineer, Rust Engineer, UI/UX Engineer, and Software Architect**.

Your task is to design and implement a production-quality Windows application for **fast screenshot capture, lightweight screen recording, annotation, OCR, and persistent recent captures**.

The product is inspired by the workflow convenience of tools such as Snagit, ShareX, and Windows Snipping Tool, but **must not be a clone**.

The core product philosophy is:

> **Extremely fast capture + lightweight background operation + excellent annotation workflow + persistent workspace.**

The application should feel instant and unobtrusive.

Do not over-engineer the first version.

---

# 1. PRODUCT GOAL

Build a lightweight Windows desktop application temporarily named:

**CaptureX**

The application should allow users to:

- Capture a region of the screen.
- Capture a specific window.
- Capture the full screen.
- Capture across multiple monitors.
- Record a selected region.
- Record a window or monitor.
- Record system audio.
- Record microphone audio.
- Quickly annotate screenshots.
- Copy screenshots immediately to clipboard.
- Keep captured images automatically in a persistent Recent workspace.
- Restore all previous captures after restarting the application or Windows.
- Keep captures until the user explicitly closes/deletes them.
- Reopen previously edited captures and continue editing annotations.
- Run quietly in the Windows system tray.
- Respond instantly to global keyboard shortcuts.

The app should prioritize:

1. Speed
2. Low memory usage
3. Low CPU usage
4. Native Windows integration
5. Excellent UX
6. Stability
7. Privacy
8. Maintainable architecture

---

# 2. TARGET PLATFORM

Initial target:

**Windows 10 / Windows 11 64-bit**

Do NOT attempt macOS or Linux support in V1.

However, architecture should avoid unnecessary coupling between business logic and Windows-specific APIs.

---

# 3. RECOMMENDED TECHNOLOGY STACK

Start by evaluating and validating this architecture:

## Core

- Rust
- Tokio only where asynchronous work is actually required
- Native Windows APIs through the `windows` Rust crate

## Desktop UI

Preferred:

**Tauri 2**

Use Tauri primarily for:

- Main workspace
- Recent captures
- Editor shell
- Settings
- Capture history
- Recording management

Do NOT force everything through WebView UI.

Native Windows windows/overlays should be used where latency or pixel accuracy matters.

## Native Windows integration

Investigate/use:

- Windows Graphics Capture
- Direct3D 11
- DXGI
- WASAPI
- Media Foundation
- Windows Clipboard API
- Windows global hotkeys
- Windows window enumeration APIs

Avoid legacy screen capture approaches when modern Windows APIs provide better performance.

---

# 4. ARCHITECTURE

Use a modular architecture approximately like:

```text
CaptureX
│
├── UI Layer
│   ├── Workspace
│   ├── Recent Captures
│   ├── Screenshot Editor
│   ├── Recording Preview
│   └── Settings
│
├── Application Layer
│   ├── Capture Manager
│   ├── Recording Manager
│   ├── Workspace Manager
│   ├── Clipboard Manager
│   └── Hotkey Manager
│
├── Native Engine
│   ├── Screenshot Engine
│   ├── Capture Overlay
│   ├── Window Detection
│   ├── Screen Recorder
│   ├── Audio Capture
│   └── Video Encoder
│
├── Image Engine
│   ├── Crop
│   ├── Resize
│   ├── Annotation
│   ├── Blur
│   ├── Pixelate
│   └── Thumbnail Generator
│
├── OCR Engine
│
└── Storage
    ├── SQLite
    ├── Capture Files
    ├── Thumbnails
    └── Project Files
```

Keep modules loosely coupled.

Native capture and recording logic must NOT depend directly on the UI.

---

# 5. SCREENSHOT WORKFLOW

Primary shortcut:

```text
Ctrl + Shift + A
```

Workflow:

```text
Hotkey
  ↓
Freeze/capture current desktop
  ↓
Display native transparent overlay
  ↓
User selects region/window
  ↓
Capture
  ↓
Copy image to clipboard immediately
  ↓
Persist capture
  ↓
Add to Recent
  ↓
Show small non-intrusive notification
```

The user should NOT be forced into the editor after every screenshot.

The expected experience should be:

```text
Ctrl + Shift + A
→ drag
→ release
→ Ctrl + V somewhere else
```

That entire interaction must feel nearly instantaneous.

---

# 6. CAPTURE OVERLAY

The capture overlay is extremely important.

Prefer native implementation rather than a normal WebView page.

Requirements:

- Transparent fullscreen overlay.
- Multi-monitor support.
- Correct DPI scaling.
- Mouse crosshair.
- Region selection.
- Window detection.
- Highlight window underneath cursor.
- ESC cancels.
- Arrow keys may allow pixel-level adjustment.
- Show selected dimensions.

Example:

```text
┌───────────────────────────────────────┐
│                                       │
│        ┌─────────────────────┐        │
│        │                     │        │
│        │      1280 × 720     │        │
│        │                     │        │
│        └─────────────────────┘        │
│                                       │
└───────────────────────────────────────┘
```

Outside the selected region should be dimmed.

Selection must remain smooth even on 4K displays.

---

# 7. CAPTURE MODES

Implement:

### V1

- Region capture
- Window capture
- Full monitor capture
- Multi-monitor awareness

Later:

- Scrolling screenshot
- Delayed screenshot
- Repeat previous region

---

# 8. IMMEDIATE CLIPBOARD

After screenshot capture:

Immediately place the image into Windows clipboard.

Do NOT wait for:

- Database insert
- Thumbnail generation
- OCR
- Editor initialization

Those operations should happen afterward where appropriate.

Conceptually:

```text
Capture
   ↓
Clipboard ← highest priority
   ↓
Persistence
   ↓
Thumbnail
   ↓
Metadata
   ↓
Optional processing
```

Clipboard responsiveness is a major performance requirement.

---

# 9. PERSISTENT RECENT WORKSPACE

This is a CORE requirement.

Captures are NOT temporary session data.

When a screenshot is taken:

1. Save the original image.
2. Create database metadata.
3. Generate thumbnail.
4. Add capture to Recent.

Closing the application MUST NOT remove captures.

Restarting Windows MUST NOT remove captures.

Captures remain until the user explicitly closes/deletes them.

Example:

```text
Recent

📌 Pinned
┌────────┐ ┌────────┐
│ image  │ │ image  │
└────────┘ └────────┘

Today
┌────────┐ ┌────────┐ ┌────────┐
│ image  │ │ image  │ │ image  │
└────────┘ └────────┘ └────────┘

Yesterday
┌────────┐ ┌────────┐
│ image  │ │ image  │
└────────┘ └────────┘
```

The Recent workspace should survive application restarts.

---

# 10. STORAGE

Use something similar to:

```text
%LocalAppData%\CaptureX\

captures/
    <uuid>.png

thumbnails/
    <uuid>.jpg

projects/
    <uuid>.json

recordings/
    <uuid>.mp4

database/
    capturex.db
```

Do not use filenames as database identifiers.

Generate UUIDs for captures.

---

# 11. SQLITE DATABASE

Create a lightweight SQLite schema.

Suggested capture entity:

```text
Capture

Id
Type
OriginalFilePath
ThumbnailFilePath
ProjectFilePath
CreatedAt
UpdatedAt
Width
Height
MonitorId
IsPinned
IsClosed
LastOpenedAt
```

Recording entity should store similar metadata.

Design indexes appropriately.

Do not perform unnecessary database queries during capture.

---

# 12. DELETE / CLOSE BEHAVIOR

Closing the application:

**does nothing to Recent captures.**

Closing a capture:

```text
Thumbnail → X
```

should remove it from active Recent.

Consider a temporary undo:

```text
Capture removed

[Undo]
```

A Trash mechanism can be introduced later.

Pinned captures should require explicit deletion.

---

# 13. EDITOR

Screenshot editor must be fast and simple.

Initial tools:

```text
Select
Arrow
Rectangle
Ellipse
Line
Free Draw
Text
Highlight
Blur
Pixelate
Step Number
Crop
Undo
Redo
```

Example toolbar:

```text
↖  ↗  □  ○  ╱  ✎  T  🖍  ▒  ①  Crop

Undo   Redo                Copy   Save
```

Avoid a Photoshop-like interface.

The editor should be optimized for technical screenshots.

---

# 14. NON-DESTRUCTIVE EDITING

Annotations should preferably be non-destructive.

Do NOT permanently paint annotations into the original screenshot while editing.

Maintain:

```text
Original image
+
Annotation objects
=
Rendered result
```

Store annotation/project state separately.

Example:

```json
{
  "captureId": "...",
  "objects": [
    {
      "type": "arrow",
      "x1": 100,
      "y1": 200,
      "x2": 450,
      "y2": 350
    },
    {
      "type": "blur",
      "x": 600,
      "y": 100,
      "width": 220,
      "height": 70
    }
  ]
}
```

Opening the application tomorrow should allow the user to continue modifying these objects.

---

# 15. STEP ANNOTATION

Implement numbered markers:

```text
①
②
③
④
```

Every new Step object automatically increments the number.

This is useful for:

- Documentation
- Bug reports
- Tutorials
- Support instructions

---

# 16. SCREEN RECORDING

Shortcut:

```text
Ctrl + Shift + R
```

Workflow:

```text
Hotkey
 ↓
Select region/window/monitor
 ↓
Configure microphone/system audio
 ↓
Record
 ↓
Pause / Resume
 ↓
Stop
 ↓
Preview
 ↓
Trim
 ↓
Save / Copy
```

Recording overlay:

```text
🔴 00:02:34

🎤 ON   🔊 ON

✏ Draw     ⏸ Pause     ■ Stop
```

Keep this overlay very small.

---

# 17. RECORDING ENGINE

Preferred architecture:

```text
Windows Graphics Capture
        ↓
       D3D11
        ↓
GPU texture/frame
        ↓
Media Foundation
        ↓
Hardware H.264 encoder
        ↓
MP4
```

Audio:

```text
WASAPI Loopback
      ↓
System Audio
      │
      ├──────┐
      │      │
Microphone   │
      ↓      ↓
    Audio Mixer
         ↓
       Encoder
```

Avoid unnecessary GPU → CPU → GPU copies.

Use hardware encoding when supported.

Fall back gracefully if hardware encoding is unavailable.

---

# 18. RECORDING SETTINGS

Support initially:

```text
FPS
- 30
- 60

Quality
- Low
- Medium
- High

Audio
☑ System Audio
☑ Microphone

Cursor
☑ Capture Cursor
```

Advanced settings can come later.

---

# 19. RECORDING PREVIEW

After stopping:

```text
Recording complete

┌──────────────────────────────┐
│                              │
│         Video Preview        │
│                              │
└──────────────────────────────┘

00:00 ━━━━━━━━━━━━━━━━━━━ 03:42

       [ Trim ]

[Open Folder] [Save] [Copy]
```

V1 editing only needs simple trim.

Do NOT build a full video editor.

---

# 20. OCR

OCR should preferably operate locally.

User selects:

```text
OCR Text
```

Then:

```text
Screenshot
   ↓
OCR
   ↓
Detected text
```

Actions:

```text
Copy Text
Select Text
```

Do not automatically send screenshots to cloud services.

Privacy is important.

---

# 21. SMART REDACTION

Later phase.

Detect likely sensitive information such as:

- Email
- IPv4 / IPv6
- Access token
- JWT
- API key
- Authorization header
- Password-like fields
- Connection strings
- Database credentials
- Phone numbers

Example:

```text
Sensitive information detected

✓ IP Address
✓ JWT
✓ Authorization Header

[Redact All]
```

This feature is particularly important for developers and technical support users.

Never modify the original image.

Create redact annotation objects.

---

# 22. GLOBAL HOTKEYS

Initial defaults:

```text
Ctrl + Shift + A
Region Capture

Ctrl + Shift + R
Screen Recording
```

Allow users to configure shortcuts.

Detect shortcut conflicts.

Do not register unnecessary global hooks.

---

# 23. SYSTEM TRAY

The application should normally remain available through Windows tray.

Menu:

```text
Capture Region
Capture Window
Capture Screen

Record Screen

Recent Captures

Settings

Exit
```

Closing the main window should preferably minimize/return to tray.

Actual **Exit** should terminate background processes cleanly.

---

# 24. STARTUP

Optional setting:

```text
☑ Start CaptureX with Windows
```

Startup should not display the main workspace unless configured.

Launch quietly into tray.

---

# 25. PERFORMANCE TARGETS

Treat performance as a product feature.

Targets:

```text
Cold startup:
< 500 ms where realistically achievable

Warm UI open:
< 200 ms perceived

Idle RAM:
Target < 50 MB
Acceptable < 100 MB

Idle CPU:
~0%

Screenshot:
Perceived capture latency < 100 ms where hardware permits

Capture overlay:
60 FPS interaction

Recording:
No unnecessary frame copies
```

Do not sacrifice stability merely to meet arbitrary benchmark numbers.

Measure everything.

---

# 26. RESOURCE MANAGEMENT

Pay special attention to:

- D3D texture lifecycle
- COM objects
- GPU resources
- Recording buffers
- Audio buffers
- WebView lifecycle
- Image decoding
- Thumbnail caching

Avoid retaining full-resolution screenshots in RAM when only thumbnails are needed.

For Recent:

```text
Database
+
small thumbnails
```

should be loaded first.

Load original images lazily.

---

# 27. LARGE HISTORY PERFORMANCE

The application should remain responsive with:

```text
10 captures
100 captures
1,000 captures
10,000 captures
```

Use:

- Virtualized lists
- Lazy loading
- Thumbnail caching
- Pagination/incremental loading
- Indexed SQLite queries

Never load thousands of full-resolution images into memory.

---

# 28. CRASH SAFETY

Screenshot persistence should be resilient.

Consider:

```text
Capture
 ↓
Write temporary file
 ↓
Flush
 ↓
Atomic rename
 ↓
Database insert
```

If the application crashes during persistence, it should recover orphan captures when restarted where practical.

Recording should also minimize the chance of losing an entire long recording due to a crash.

---

# 29. PRIVACY

Default behavior:

**100% local.**

Do not:

- Upload screenshots automatically.
- Upload recordings automatically.
- Send OCR data externally.
- Add analytics without explicit configuration.
- Collect screenshot content.

Future cloud sharing must be optional.

---

# 30. UI DESIGN

Design language:

- Minimal
- Modern
- Windows-friendly
- Fast
- Compact
- Dark/light mode
- High DPI
- Keyboard friendly

Avoid excessive animations.

Animations should only communicate state and should never slow down capture.

Main workspace concept:

```text
┌──────────────────────────────────────────────────────────┐
│ CaptureX                                    ⚙  ─  □  × │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Recent                                                   │
│                                                          │
│ [img] [img] [img] [img] [img]                           │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                                                          │
│                  Current Capture                         │
│                                                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ↗  □  ○  T  ✎  Blur  ①  Crop          Copy   Save      │
└──────────────────────────────────────────────────────────┘
```

---

# 31. DO NOT OVER-ENGINEER

Do NOT start by implementing:

- Accounts
- Cloud sync
- Team collaboration
- AI assistant
- Video editor
- Plugin marketplace
- Browser extension
- macOS
- Linux
- Mobile application

Build the core capture experience first.

---

# 32. DEVELOPMENT PHASES

## Phase 0 — Technical Prototype

Prove:

- Rust application starts correctly.
- Native Windows API access works.
- Global hotkey works.
- Region overlay works.
- Screenshot can be captured.
- Screenshot can be copied to clipboard.
- Multi-monitor coordinates work.
- DPI scaling works.

Do NOT build polished UI yet.

---

## Phase 1 — Screenshot MVP

Implement:

- Tray application
- Global hotkey
- Region capture
- Window capture
- Monitor capture
- Clipboard
- PNG persistence
- SQLite
- Recent captures
- Persistent workspace
- Thumbnail generation
- Delete/close
- Basic settings

At this point the app should already be useful daily.

---

## Phase 2 — Screenshot Editor

Implement:

- Arrow
- Rectangle
- Ellipse
- Line
- Text
- Highlight
- Draw
- Blur
- Pixelate
- Step numbers
- Crop
- Undo/Redo
- Non-destructive projects
- Restore project after restart

---

## Phase 3 — Recording

Implement:

- Region recording
- Window recording
- Monitor recording
- D3D capture
- H.264
- MP4
- Hardware encoding
- System audio
- Microphone
- Cursor
- Pause/resume
- Recording preview
- Simple trim

---

## Phase 4 — Advanced Capture

Implement:

- Scrolling screenshot
- Delayed capture
- Repeat previous region
- Better window/control detection
- GIF export

---

## Phase 5 — Developer Features

Implement:

- Local OCR
- OCR copy
- Sensitive-data detection
- Smart Redact
- Developer-oriented annotation improvements

---

# 33. TESTING REQUIREMENTS

Test at minimum:

### Displays

- 1080p
- 1440p
- 4K

### DPI

- 100%
- 125%
- 150%
- 175%
- 200%

### Monitor configurations

- Single monitor
- Dual monitor
- Different resolutions
- Different DPI per monitor
- Monitor positioned left of primary
- Monitor positioned above primary

Negative screen coordinates must work correctly.

### Recording

Test:

- 1080p30
- 1080p60
- 1440p60
- 4K where hardware supports it

Measure:

- CPU
- GPU
- RAM
- dropped frames
- audio/video synchronization

---

# 34. BENCHMARKING

Create internal performance instrumentation.

Measure:

```text
App startup
Hotkey → overlay
Mouse release → clipboard ready
Mouse release → file persisted
Thumbnail generation
Recent workspace load
Editor load
Recording initialization
Recording dropped frames
Memory usage
```

Performance regressions should be detectable.

---

# 35. CODE QUALITY

Requirements:

- Clear module boundaries.
- Small focused components.
- Strong Rust types.
- Avoid unnecessary cloning.
- Avoid unnecessary allocations.
- No blocking I/O on UI thread.
- Proper error propagation.
- Structured logging.
- No silent error swallowing.

Use comments to explain **why**, not obvious code behavior.

---

# 36. ERROR HANDLING

User-facing errors should be understandable.

Bad:

```text
HRESULT 0x887A0005
```

Better:

```text
Screen capture was interrupted because the graphics device was reset.

[Try Again]
```

Technical HRESULT/error details can be written to logs.

---

# 37. LOGGING

Store application logs separately from user captures.

Never log:

- Screenshot pixel data
- OCR content
- Clipboard contents
- Tokens
- Sensitive captured information

Logs should focus on:

- Performance
- Errors
- Device initialization
- Capture engine state
- Recording state

---

# 38. FIRST IMPLEMENTATION TASK

Do NOT attempt to implement the whole product immediately.

Start with a vertical slice:

```text
Launch CaptureX
       ↓
Register Ctrl+Shift+A
       ↓
Press shortcut
       ↓
Native capture overlay
       ↓
Select region
       ↓
Capture pixels
       ↓
Copy PNG/image to clipboard
       ↓
Persist image
       ↓
Store metadata
       ↓
Show thumbnail in Recent
       ↓
Exit application
       ↓
Start application again
       ↓
Previous capture is still in Recent
       ↓
Press X on capture
       ↓
Capture disappears
```

This workflow must be solid before implementing recording.

---

# 39. BEFORE WRITING CODE

First produce:

1. Final architecture proposal.
2. Repository/folder structure.
3. Rust crates/dependencies required.
4. Native Windows APIs required.
5. Tauri/native boundary.
6. SQLite schema.
7. Capture pipeline.
8. Persistence lifecycle.
9. Threading model.
10. GPU/resource lifecycle.
11. Error handling strategy.
12. Performance strategy.
13. Major technical risks.
14. Implementation milestones.

For every major dependency, explain why it is needed.

Avoid adding dependencies that can easily be replaced by the standard library or existing platform APIs.

---

# 40. THEN IMPLEMENT ITERATIVELY

After the architecture is established:

### Milestone 1
Create project skeleton and compile successfully.

### Milestone 2
Implement tray + global hotkey.

### Milestone 3
Implement native fullscreen selection overlay.

### Milestone 4
Implement region screenshot.

### Milestone 5
Implement immediate clipboard.

### Milestone 6
Implement persistent capture storage.

### Milestone 7
Implement SQLite metadata.

### Milestone 8
Implement Recent workspace.

### Milestone 9
Implement persistent restart/restore.

### Milestone 10
Implement basic editor.

Do not move to screen recording until screenshot capture is stable.

---

# 41. IMPORTANT ENGINEERING RULE

Whenever there are multiple possible approaches, compare them using:

```text
Performance
Memory
Startup time
Implementation complexity
Windows compatibility
Maintenance cost
Failure modes
```

Do not select a technology simply because it is popular.

If Tauri/WebView becomes the bottleneck for a particular feature, implement that feature natively.

If another technology is objectively better than the proposed Rust + Tauri architecture, explain the evidence and trade-offs before changing architecture.

---

# 42. PRODUCT PRINCIPLE

Every feature must answer:

> Does this make capturing, editing, or sharing information faster?

If not, it probably does not belong in V1.

The desired experience is:

```text
Press shortcut
      ↓
Capture
      ↓
Paste
```

in seconds.

For editing:

```text
Capture
   ↓
Recent
   ↓
Annotate
   ↓
Copy
```

For long-term workspace:

```text
Capture today
   ↓
Close CaptureX
   ↓
Restart Windows
   ↓
Open CaptureX tomorrow
   ↓
Capture + annotations are still there
```

The application should ultimately feel like a **native Windows utility that happens to have powerful features**, not a large desktop application that happens to take screenshots.