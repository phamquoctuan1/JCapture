import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CaptureRecord } from "./types";
import { Header } from "./components/Header";
import { RecentWorkspace } from "./components/RecentWorkspace";
import { EditorModal } from "./components/editor/EditorModal";
import { SettingsModal } from "./components/SettingsModal";
import { RecordingToolbar } from "./components/recorder/RecordingToolbar";
import { VideoPlayerModal } from "./components/recorder/VideoPlayerModal";

export default function App() {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [activeEditorRecord, setActiveEditorRecord] = useState<CaptureRecord | null>(null);
  const [activeVideoRecord, setActiveVideoRecord] = useState<CaptureRecord | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [captureShortcut, setCaptureShortcut] = useState<string>("Alt+A");
  const [fullscreenShortcut, setFullscreenShortcut] = useState<string>("Ctrl+Shift+F");
  const [recordShortcut, setRecordShortcut] = useState<string>("Ctrl+Shift+R");

  // Screen recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartTimeRef = useRef<number>(0);

  // Load Recent Captures & Settings on Mount
  useEffect(() => {
    const fetchCaptures = async () => {
      try {
        const data = await invoke<CaptureRecord[]>("get_recent_captures");
        setCaptures(data);
      } catch (err) {
        console.error("Failed to load captures:", err);
      }
    };

    const fetchSettings = async () => {
      try {
        const settings = await invoke<{
          hotkeyCapture: string;
          hotkeyFullscreen?: string;
          hotkeyRecord?: string;
        }>("get_app_settings");
        if (settings?.hotkeyCapture) {
          setCaptureShortcut(settings.hotkeyCapture);
        }
        if (settings?.hotkeyFullscreen) {
          setFullscreenShortcut(settings.hotkeyFullscreen);
        }
        if (settings?.hotkeyRecord) {
          setRecordShortcut(settings.hotkeyRecord);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };

    fetchCaptures();
    fetchSettings();

    // Auto-refresh when window gains focus
    const onWindowFocus = () => {
      fetchCaptures();
    };
    window.addEventListener("focus", onWindowFocus);

    // Listen for new captures emitted from native overlay / hotkey
    const unlistenCapturePromise = listen<CaptureRecord>("capture:new", (event) => {
      const record = event.payload;
      setCaptures((prev) => [record, ...prev.filter((c) => c.id !== record.id)]);
      if (record.captureType === "recording") {
        setActiveVideoRecord(record);
      } else {
        setActiveEditorRecord(record);
      }

      const win = getCurrentWindow();
      win.show();
      win.unminimize();
      win.setFocus();
    });

    // Global shortcut Ctrl+N for new blank canvas
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        handleNewBlankCanvas();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("keydown", handleGlobalKeyDown);
      unlistenCapturePromise.then((unlisten) => unlisten());
    };
  }, []);

  const isCreatingBlankRef = useRef(false);

  const handleNewBlankCanvas = async () => {
    if (isCreatingBlankRef.current) return;
    isCreatingBlankRef.current = true;
    try {
      const blankRecord = await invoke<CaptureRecord>("create_blank_canvas", {
        width: 1600,
        height: 900,
      });
      setCaptures((prev) => [blankRecord, ...prev]);
      setActiveEditorRecord(blankRecord);
    } catch (err) {
      console.error("Failed to create blank canvas:", err);
    } finally {
      setTimeout(() => {
        isCreatingBlankRef.current = false;
      }, 300);
    }
  };

  const handleTriggerCapture = async () => {
    try {
      await invoke("trigger_capture");
    } catch (err) {
      console.error("Failed to trigger capture:", err);
    }
  };

  const handleTriggerFullscreenCapture = async () => {
    try {
      await invoke("trigger_fullscreen_capture");
    } catch (err) {
      console.error("Failed to trigger fullscreen capture:", err);
    }
  };

  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;

  // Listen for screen recording start from global hotkey
  useEffect(() => {
    const unlistenRecordPromise = listen("record:start", () => {
      if (isRecordingRef.current) {
        handleStopRecording();
      } else {
        handleStartRecording();
      }
    });
    return () => {
      unlistenRecordPromise.then((u) => u());
    };
  }, []);

  // --- Screen Recording Workflow ---
  const handleStartRecording = async () => {
    try {
      // 1. Request Display Stream with fallback
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 60 } },
          audio: true,
        });
      } catch (errWithAudio) {
        console.warn("getDisplayMedia with audio failed, falling back to video only:", errWithAudio);
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 60 } },
        });
      }

      let combinedStream = displayStream;

      // 2. Add microphone stream if enabled
      if (isMicEnabled) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioCtx = new AudioContext();
          const dest = audioCtx.createMediaStreamDestination();

          if (displayStream.getAudioTracks().length > 0) {
            const sysSrc = audioCtx.createMediaStreamSource(displayStream);
            sysSrc.connect(dest);
          }
          const micSrc = audioCtx.createMediaStreamSource(micStream);
          micSrc.connect(dest);

          combinedStream = new MediaStream([
            ...displayStream.getVideoTracks(),
            ...dest.stream.getAudioTracks(),
          ]);
        } catch (micErr) {
          console.warn("Could not capture mic audio:", micErr);
        }
      }

      streamRef.current = combinedStream;
      recordedChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();

      // 3. Choose supported MIME type
      const mimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ];
      let selectedMime = "";
      for (const m of mimeTypes) {
        if (MediaRecorder.isTypeSupported(m)) {
          selectedMime = m;
          break;
        }
      }

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: selectedMime || undefined,
        videoBitsPerSecond: 6000000, // 6 Mbps high quality
      });

      // Create a hidden video element to capture a live thumbnail frame
      const liveVideo = document.createElement("video");
      liveVideo.srcObject = combinedStream;
      liveVideo.muted = true;
      liveVideo.playsInline = true;
      liveVideo.play().catch(() => {});

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const durationMs = Date.now() - recordingStartTimeRef.current;
        const videoBlob = new Blob(recordedChunksRef.current, {
          type: selectedMime || "video/webm",
        });

        // 1. Grab thumbnail immediately from liveVideo before stopping tracks
        let thumbBase64 = "";
        let width = 1920;
        let height = 1080;
        try {
          const canvas = document.createElement("canvas");
          width = liveVideo.videoWidth || 1920;
          height = liveVideo.videoHeight || 1080;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(liveVideo, 0, 0, width, height);
            thumbBase64 = canvas.toDataURL("image/png");
          }
        } catch (e) {
          console.warn("Could not capture thumbnail frame:", e);
        }

        // Clean up streams
        combinedStream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setIsRecording(false);
        setIsPaused(false);

        // 2. Read video blob directly to base64 and save to Rust backend!
        const reader = new FileReader();
        reader.onloadend = async () => {
          const videoBase64 = reader.result as string;
          try {
            const savedRecord = await invoke<CaptureRecord>("save_video_recording", {
              base64Video: videoBase64,
              base64Thumbnail:
                thumbBase64 ||
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              width,
              height,
              durationMs,
            });

            setCaptures((prev) => [savedRecord, ...prev]);
            setActiveVideoRecord(savedRecord);

            const win = getCurrentWindow();
            await win.show();
            await win.unminimize();
            await win.setFocus();
          } catch (saveErr) {
            console.error("Failed to save recording record:", saveErr);
          }
        };
        reader.readAsDataURL(videoBlob);
      };

      // Handle user stopping screen share via browser bar
      displayStream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(500); // 500ms chunk interval
      setIsRecording(true);
      setIsPaused(false);
    } catch (e) {
      console.error("Screen recording setup failed / cancelled:", e);
    }
  };

  const handlePauseResumeRecording = () => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCancelRecording = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    setIsRecording(false);
    setIsPaused(false);
  };

  const handleTogglePin = async (id: string, isPinned: boolean) => {
    try {
      await invoke("toggle_pin_capture", { id, isPinned });
      setCaptures((prev) =>
        prev
          .map((c) => (c.id === id ? { ...c, isPinned } : c))
          .sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            return b.createdAt - a.createdAt;
          })
      );
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_capture", { id });
      setCaptures((prev) => prev.filter((c) => c.id !== id));
      if (activeEditorRecord?.id === id) {
        setActiveEditorRecord(null);
      }
      if (activeVideoRecord?.id === id) {
        setActiveVideoRecord(null);
      }
    } catch (err) {
      console.error("Failed to delete capture:", err);
    }
  };

  const handleToggleAlwaysOnTop = async () => {
    const nextState = !isAlwaysOnTop;
    setIsAlwaysOnTop(nextState);
    const win = getCurrentWindow();
    await win.setAlwaysOnTop(nextState);
  };

  const [initialMergeConfig, setInitialMergeConfig] = useState<import("./components/editor/EditorModal").InitialMergeConfig | undefined>(undefined);

  const handleUpdateRecord = (updated: CaptureRecord) => {
    setCaptures((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setActiveEditorRecord(updated);
  };

  const handleMergeSelected = async (records: CaptureRecord[], layout: "horizontal" | "vertical" | "grid") => {
    try {
      const blankRecord = await invoke<CaptureRecord>("create_blank_canvas", {
        width: 1600,
        height: 1000,
      });
      setCaptures((prev) => [blankRecord, ...prev]);
      setInitialMergeConfig({ records, layout });
      setActiveEditorRecord(blankRecord);
    } catch (err) {
      console.error("Failed to create merge canvas:", err);
    }
  };

  const handleDeleteMultiple = async (ids: string[]) => {
    try {
      for (const id of ids) {
        await invoke("delete_capture", { id });
      }
      setCaptures((prev) => prev.filter((c) => !ids.includes(c.id)));
      if (activeEditorRecord && ids.includes(activeEditorRecord.id)) {
        setActiveEditorRecord(null);
      }
      if (activeVideoRecord && ids.includes(activeVideoRecord.id)) {
        setActiveVideoRecord(null);
      }
    } catch (err) {
      console.error("Failed to delete captures:", err);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 select-none overflow-hidden border border-zinc-800/80 rounded-lg shadow-2xl">
      <Header
        onTriggerCapture={handleTriggerCapture}
        onTriggerFullscreenCapture={handleTriggerFullscreenCapture}
        onTriggerRecord={handleStartRecording}
        onNewBlankCanvas={handleNewBlankCanvas}
        onOpenSettings={() => setShowSettings(true)}
        isAlwaysOnTop={isAlwaysOnTop}
        onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
        captureShortcut={captureShortcut}
        fullscreenShortcut={fullscreenShortcut}
        recordShortcut={recordShortcut}
      />

      <main className="flex-1 flex overflow-hidden">
        <RecentWorkspace
          captures={captures}
          captureShortcut={captureShortcut}
          onOpenEditor={(record) => {
            if (record.captureType === "recording") {
              setActiveVideoRecord(record);
            } else {
              setInitialMergeConfig(undefined);
              setActiveEditorRecord(record);
            }
          }}
          onTogglePin={handleTogglePin}
          onDelete={handleDelete}
          onDeleteMultiple={handleDeleteMultiple}
          onTriggerCapture={handleTriggerCapture}
          onMergeSelected={handleMergeSelected}
        />
      </main>

      {/* Floating Recording Toolbar */}
      <RecordingToolbar
        isRecording={isRecording}
        isPaused={isPaused}
        onPauseResume={handlePauseResumeRecording}
        onStop={handleStopRecording}
        onCancel={handleCancelRecording}
        isMicEnabled={isMicEnabled}
        onToggleMic={() => setIsMicEnabled(!isMicEnabled)}
      />

      {/* Video Player Modal */}
      {activeVideoRecord && (
        <VideoPlayerModal
          record={activeVideoRecord}
          onClose={() => setActiveVideoRecord(null)}
          onDelete={handleDelete}
        />
      )}

      {/* Editor Modal */}
      {activeEditorRecord && (
        <EditorModal
          record={activeEditorRecord}
          captures={captures}
          initialMerge={initialMergeConfig}
          onSelectRecord={(record) => {
            if (record.captureType === "recording") {
              setActiveEditorRecord(null);
              setActiveVideoRecord(record);
            } else {
              setInitialMergeConfig(undefined);
              setActiveEditorRecord(record);
            }
          }}
          onClose={() => {
            setActiveEditorRecord(null);
            setInitialMergeConfig(undefined);
          }}
          onUpdateRecord={handleUpdateRecord}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSettingsSaved={(newSettings) => {
            if (newSettings.hotkeyCapture) setCaptureShortcut(newSettings.hotkeyCapture);
            if (newSettings.hotkeyFullscreen) setFullscreenShortcut(newSettings.hotkeyFullscreen);
            if (newSettings.hotkeyRecord) setRecordShortcut(newSettings.hotkeyRecord);
          }}
        />
      )}
    </div>
  );
}

