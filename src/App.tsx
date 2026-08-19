import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CaptureRecord } from "./types";
import { Header } from "./components/Header";
import { RecentWorkspace } from "./components/RecentWorkspace";
import { EditorModal } from "./components/editor/EditorModal";
import { SettingsModal } from "./components/SettingsModal";

export default function App() {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [activeEditorRecord, setActiveEditorRecord] = useState<CaptureRecord | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [captureShortcut, setCaptureShortcut] = useState<string>("Alt+A");

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
        const settings = await invoke<{ hotkeyCapture: string }>("get_app_settings");
        if (settings?.hotkeyCapture) {
          setCaptureShortcut(settings.hotkeyCapture);
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
    const unlistenPromise = listen<CaptureRecord>("capture:new", (event) => {
      const record = event.payload;
      setCaptures((prev) => [record, ...prev.filter((c) => c.id !== record.id)]);
      setActiveEditorRecord(record);

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
      unlistenPromise.then((unlisten) => unlisten());
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
    } catch (err) {
      console.error("Failed to delete captures:", err);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 select-none overflow-hidden border border-zinc-800/80 rounded-lg shadow-2xl">
      <Header
        onTriggerCapture={handleTriggerCapture}
        onTriggerFullscreenCapture={handleTriggerFullscreenCapture}
        onNewBlankCanvas={handleNewBlankCanvas}
        onOpenSettings={() => setShowSettings(true)}
        isAlwaysOnTop={isAlwaysOnTop}
        onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
        captureShortcut={captureShortcut}
      />

      <main className="flex-1 flex overflow-hidden">
        <RecentWorkspace
          captures={captures}
          captureShortcut={captureShortcut}
          onOpenEditor={(record) => {
            setInitialMergeConfig(undefined);
            setActiveEditorRecord(record);
          }}
          onTogglePin={handleTogglePin}
          onDelete={handleDelete}
          onDeleteMultiple={handleDeleteMultiple}
          onTriggerCapture={handleTriggerCapture}
          onMergeSelected={handleMergeSelected}
        />
      </main>

      {/* Editor Modal */}
      {activeEditorRecord && (
        <EditorModal
          record={activeEditorRecord}
          captures={captures}
          initialMerge={initialMergeConfig}
          onSelectRecord={(record) => {
            setInitialMergeConfig(undefined);
            setActiveEditorRecord(record);
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
          onSettingsSaved={(newSettings) => setCaptureShortcut(newSettings.hotkeyCapture)}
        />
      )}
    </div>
  );
}
