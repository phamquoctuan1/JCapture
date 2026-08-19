import React, { useEffect, useState } from "react";
import {
  X,
  Check,
  Keyboard,
  Power,
  Clipboard,
  Sliders,
  RefreshCw,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { AppSettings } from "../types";

interface SettingsModalProps {
  onClose: () => void;
  onSettingsSaved?: (newSettings: AppSettings) => void;
}

const CURRENT_VERSION = "v0.1.0";
const DEFAULT_REPO = "phamquoctuan1/JCapture";

interface ReleaseInfo {
  tag_name: string;
  html_url: string;
  name: string;
  body: string;
  published_at: string;
}

const PRESET_SHORTCUTS = [
  "Alt+A",
  "Ctrl+Shift+A",
  "Ctrl+Alt+A",
  "PrintScreen",
  "F1",
  "F2",
  "Ctrl+Shift+X",
  "Alt+S",
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  onSettingsSaved,
}) => {
  const [settings, setSettings] = useState<AppSettings>({
    hotkeyCapture: "Alt+A",
    hotkeyRecord: "Ctrl+Shift+R",
    autoStartWithWindows: false,
    copyToClipboardOnCapture: true,
    openEditorOnCapture: false,
    saveDirectory: "",
  });
  const [isRecordingCapture, setIsRecordingCapture] = useState(false);
  const [saved, setSaved] = useState(false);

  // Update checking state
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "latest" | "available" | "error"
  >("idle");
  const [latestRelease, setLatestRelease] = useState<ReleaseInfo | null>(null);
  const [updateError, setUpdateError] = useState<string>("");

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const s = await invoke<AppSettings>("get_app_settings");
        setSettings(s);
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    loadSettings();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecordingCapture) return;
    e.preventDefault();

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Win");

    let key = e.key.toUpperCase();
    if (["CONTROL", "ALT", "SHIFT", "META"].includes(key)) {
      return;
    }

    if (key === "PRINTSCREEN") key = "PrintScreen";
    if (key === " ") key = "Space";

    parts.push(key);
    const newShortcut = parts.join("+");

    setSettings({ ...settings, hotkeyCapture: newShortcut });
    setIsRecordingCapture(false);
  };

  const handleSave = async () => {
    try {
      await invoke("save_app_settings", { settings });
      if (onSettingsSaved) {
        onSettingsSaved(settings);
      }
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 600);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus("idle");
    setUpdateError("");

    try {
      const response = await fetch(
        `https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          setUpdateStatus("latest");
          return;
        }
        throw new Error(`GitHub API returned status ${response.status}`);
      }

      const release: ReleaseInfo = await response.json();
      setLatestRelease(release);

      const latestVer = release.tag_name.replace(/^v/, "").trim();
      const currentVer = CURRENT_VERSION.replace(/^v/, "").trim();

      if (latestVer !== currentVer) {
        setUpdateStatus("available");
      } else {
        setUpdateStatus("latest");
      }
    } catch (err: any) {
      console.error("Failed to check update:", err);
      setUpdateStatus("error");
      setUpdateError(err.message || "Failed to connect to GitHub");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleOpenReleasePage = async () => {
    if (latestRelease?.html_url) {
      try {
        await open(latestRelease.html_url);
      } catch {
        window.open(latestRelease.html_url, "_blank");
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-400" />
            <h2 className="font-semibold text-sm text-zinc-100">Preferences</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-6 overflow-y-auto flex-1 text-xs">
          {/* Shortcuts */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
              <Keyboard className="w-3.5 h-3.5" />
              <span>Global Shortcuts</span>
            </div>

            {/* Region Capture Hotkey */}
            <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-300">Capture Shortcut:</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={settings.hotkeyCapture}
                    onChange={(e) => setSettings({ ...settings, hotkeyCapture: e.target.value })}
                    className="w-32 bg-zinc-900 border border-zinc-700 px-2 py-1 rounded text-sky-400 font-mono text-xs text-center focus:outline-none focus:border-sky-500"
                    placeholder="e.g. Alt+A"
                  />
                  <button
                    onClick={() => setIsRecordingCapture(!isRecordingCapture)}
                    className={`px-2.5 py-1 rounded font-mono font-semibold text-xs transition-all ${
                      isRecordingCapture
                        ? "bg-amber-500 text-black ring-2 ring-amber-400 animate-pulse"
                        : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                    }`}
                    title="Click then press any key combination on keyboard"
                  >
                    {isRecordingCapture ? "Press key..." : "Record"}
                  </button>
                </div>
              </div>

              {/* Presets */}
              <div className="pt-1 flex flex-wrap gap-1 items-center">
                <span className="text-[10px] text-zinc-400 mr-1">Presets:</span>
                {PRESET_SHORTCUTS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      setSettings({ ...settings, hotkeyCapture: preset });
                      setIsRecordingCapture(false);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      settings.hotkeyCapture === preset
                        ? "bg-sky-600 text-white font-semibold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Screen Recording Hotkey (Future) */}
            <div className="flex items-center justify-between bg-zinc-950/60 p-3 rounded-lg border border-zinc-800">
              <span>Screen Recording:</span>
              <kbd className="px-2.5 py-1 bg-zinc-800 border border-zinc-700 rounded text-sky-400 font-mono text-[11px]">
                {settings.hotkeyRecord}
              </kbd>
            </div>
          </div>

          {/* Behavior */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
              <Power className="w-3.5 h-3.5" />
              <span>Startup & Behavior</span>
            </div>

            <label className="flex items-center justify-between bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800 cursor-pointer">
              <span className="flex items-center gap-2">
                <Clipboard className="w-3.5 h-3.5 text-zinc-400" />
                <span>Auto copy image to clipboard</span>
              </span>
              <input
                type="checkbox"
                checked={settings.copyToClipboardOnCapture}
                onChange={(e) =>
                  setSettings({ ...settings, copyToClipboardOnCapture: e.target.checked })
                }
                className="rounded accent-sky-500 w-4 h-4 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800 cursor-pointer">
              <span>Start JCapture minimized in tray with Windows</span>
              <input
                type="checkbox"
                checked={settings.autoStartWithWindows}
                onChange={(e) =>
                  setSettings({ ...settings, autoStartWithWindows: e.target.checked })
                }
                className="rounded accent-sky-500 w-4 h-4 cursor-pointer"
              />
            </label>
          </div>

          {/* Software Updates (GitHub Releases) */}
          <div className="space-y-3 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                <span>Software Update</span>
              </div>
              <span className="text-[11px] text-zinc-400 font-mono">
                Current: {CURRENT_VERSION}
              </span>
            </div>

            <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">GitHub Releases:</span>
                <button
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate}
                  className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-sky-400 rounded-md font-medium text-xs transition-colors border border-zinc-700"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? "animate-spin" : ""}`} />
                  <span>{checkingUpdate ? "Checking..." : "Check for Updates"}</span>
                </button>
              </div>

              {updateStatus === "latest" && (
                <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] bg-emerald-950/40 p-2 rounded border border-emerald-800/40">
                  <Check className="w-3.5 h-3.5" />
                  <span>You have the latest version installed ({CURRENT_VERSION})!</span>
                </div>
              )}

              {updateStatus === "available" && latestRelease && (
                <div className="space-y-2 bg-sky-950/40 p-2.5 rounded border border-sky-800/40 text-[11px]">
                  <div className="flex items-center justify-between text-sky-300 font-semibold">
                    <span>New version available: {latestRelease.tag_name}</span>
                    <button
                      onClick={handleOpenReleasePage}
                      className="flex items-center gap-1 text-sky-400 hover:text-sky-200 underline"
                    >
                      <span>Download</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  {latestRelease.body && (
                    <p className="text-zinc-400 line-clamp-3 text-[10px] whitespace-pre-line">
                      {latestRelease.body}
                    </p>
                  )}
                </div>
              )}

              {updateStatus === "error" && (
                <div className="flex items-center gap-1.5 text-amber-400 text-[11px] bg-amber-950/40 p-2 rounded border border-amber-800/40">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{updateError || "Could not reach GitHub Releases."}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-lg text-xs font-medium transition-all shadow-md shadow-sky-600/20"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : null}
            <span>{saved ? "Saved" : "Save Changes"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
