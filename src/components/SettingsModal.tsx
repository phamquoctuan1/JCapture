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
  Download,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings } from "../types";

interface SettingsModalProps {
  onClose: () => void;
  onSettingsSaved?: (newSettings: AppSettings) => void;
}

const DEFAULT_REPO = "phamquoctuan1/JCapture";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface ReleaseInfo {
  tag_name: string;
  html_url: string;
  name: string;
  body: string;
  published_at: string;
  assets?: ReleaseAsset[];
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

const PRESET_FULLSCREEN_SHORTCUTS = [
  "Ctrl+Shift+F",
  "Alt+PrintScreen",
  "Ctrl+Alt+A",
  "PrintScreen",
  "F2",
  "Alt+F",
];

const PRESET_RECORD_SHORTCUTS = [
  "Ctrl+Shift+R",
  "Ctrl+Alt+R",
  "F9",
  "F10",
  "Alt+R",
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  onSettingsSaved,
}) => {
  const [settings, setSettings] = useState<AppSettings>({
    hotkeyCapture: "Alt+A",
    hotkeyFullscreen: "Ctrl+Shift+F",
    hotkeyRecord: "Ctrl+Shift+R",
    autoStartWithWindows: false,
    copyToClipboardOnCapture: true,
    openEditorOnCapture: false,
    saveDirectory: "",
  });
  const [isRecordingCapture, setIsRecordingCapture] = useState(false);
  const [isRecordingFullscreen, setIsRecordingFullscreen] = useState(false);
  const [isRecordingRecord, setIsRecordingRecord] = useState(false);
  const [saved, setSaved] = useState(false);

  // Update checking state
  const [runningVersion, setRunningVersion] = useState<string>("0.2.8");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "latest" | "available" | "error"
  >("idle");
  const [latestRelease, setLatestRelease] = useState<ReleaseInfo | null>(null);
  const [updateError, setUpdateError] = useState<string>("");

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const s = await invoke<AppSettings>("get_app_settings");
        setSettings({
          ...s,
          hotkeyFullscreen: s.hotkeyFullscreen || "Ctrl+Shift+F",
          hotkeyRecord: s.hotkeyRecord || "Ctrl+Shift+R",
        });
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
      try {
        const ver = await invoke<string>("get_app_version");
        if (ver) setRunningVersion(ver);
      } catch (err) {
        console.error("Failed to get running version:", err);
      }
    };
    loadSettings();
    handleCheckUpdate();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecordingCapture && !isRecordingFullscreen && !isRecordingRecord) return;
    e.preventDefault();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    const key = e.key.toUpperCase();
    if (!["CONTROL", "ALT", "SHIFT", "META"].includes(key)) {
      parts.push(key);
      const combo = parts.join("+");
      if (isRecordingCapture) {
        setSettings((prev) => ({ ...prev, hotkeyCapture: combo }));
        setIsRecordingCapture(false);
      } else if (isRecordingFullscreen) {
        setSettings((prev) => ({ ...prev, hotkeyFullscreen: combo }));
        setIsRecordingFullscreen(false);
      } else if (isRecordingRecord) {
        setSettings((prev) => ({ ...prev, hotkeyRecord: combo }));
        setIsRecordingRecord(false);
      }
    }
  };

  const handleSave = async () => {
    try {
      await invoke("save_app_settings", { settings });
      if (onSettingsSaved) onSettingsSaved(settings);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 600);
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert(`Không thể lưu cài đặt: ${err}`);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus("idle");
    setUpdateError("");
    setDownloadMessage("");

    try {
      let activeVer = runningVersion;
      try {
        const ver = await invoke<string>("get_app_version");
        if (ver) {
          activeVer = ver;
          setRunningVersion(ver);
        }
      } catch (_) {}

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
      const currentVer = activeVer.replace(/^v/, "").trim();

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

  const handleDownloadAndInstall = async () => {
    if (!latestRelease) return;
    setIsDownloading(true);
    setDownloadMessage("Downloading latest update from GitHub...");

    const portableAsset = latestRelease.assets?.find((a) => a.name.includes("Portable.exe"));
    const setupAsset = latestRelease.assets?.find((a) => a.name.includes("setup.exe") || a.name.endsWith(".exe") || a.name.endsWith(".msi"));
    const exeAsset = portableAsset || setupAsset;

    try {
      if (exeAsset) {
        setDownloadMessage("Updating JCapture and restarting into new version...");
        await invoke("download_and_install_update", {
          downloadUrl: exeAsset.browser_download_url,
        });
      } else {
        window.open(latestRelease.html_url, "_blank");
      }
    } catch (err: any) {
      console.error("Failed to download and install update:", err);
      setUpdateError(err.message || "Download failed. Please check network.");
      setUpdateStatus("error");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenReleasePage = () => {
    if (latestRelease?.html_url) {
      window.open(latestRelease.html_url, "_blank");
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

            {/* Fullscreen Capture Hotkey */}
            <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-300">Fullscreen Shortcut:</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={settings.hotkeyFullscreen || "Ctrl+Shift+F"}
                    onChange={(e) => setSettings({ ...settings, hotkeyFullscreen: e.target.value })}
                    className="w-32 bg-zinc-900 border border-zinc-700 px-2 py-1 rounded text-sky-400 font-mono text-xs text-center focus:outline-none focus:border-sky-500"
                    placeholder="e.g. Ctrl+Shift+F"
                  />
                  <button
                    onClick={() => setIsRecordingFullscreen(!isRecordingFullscreen)}
                    className={`px-2.5 py-1 rounded font-mono font-semibold text-xs transition-all ${
                      isRecordingFullscreen
                        ? "bg-amber-500 text-black ring-2 ring-amber-400 animate-pulse"
                        : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                    }`}
                    title="Click then press any key combination on keyboard"
                  >
                    {isRecordingFullscreen ? "Press key..." : "Record"}
                  </button>
                </div>
              </div>

              {/* Presets */}
              <div className="pt-1 flex flex-wrap gap-1 items-center">
                <span className="text-[10px] text-zinc-400 mr-1">Presets:</span>
                {PRESET_FULLSCREEN_SHORTCUTS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      setSettings({ ...settings, hotkeyFullscreen: preset });
                      setIsRecordingFullscreen(false);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      (settings.hotkeyFullscreen || "Ctrl+Shift+F") === preset
                        ? "bg-sky-600 text-white font-semibold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Screen Recording Hotkey */}
            <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-300">Recording Shortcut:</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={settings.hotkeyRecord || "Ctrl+Shift+R"}
                    onChange={(e) => setSettings({ ...settings, hotkeyRecord: e.target.value })}
                    className="w-32 bg-zinc-900 border border-zinc-700 px-2 py-1 rounded text-sky-400 font-mono text-xs text-center focus:outline-none focus:border-sky-500"
                    placeholder="e.g. Ctrl+Shift+R"
                  />
                  <button
                    onClick={() => setIsRecordingRecord(!isRecordingRecord)}
                    className={`px-2.5 py-1 rounded font-mono font-semibold text-xs transition-all ${
                      isRecordingRecord
                        ? "bg-amber-500 text-black ring-2 ring-amber-400 animate-pulse"
                        : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                    }`}
                    title="Click then press any key combination on keyboard"
                  >
                    {isRecordingRecord ? "Press key..." : "Record"}
                  </button>
                </div>
              </div>

              {/* Presets */}
              <div className="pt-1 flex flex-wrap gap-1 items-center">
                <span className="text-[10px] text-zinc-400 mr-1">Presets:</span>
                {PRESET_RECORD_SHORTCUTS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      setSettings({ ...settings, hotkeyRecord: preset });
                      setIsRecordingRecord(false);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      (settings.hotkeyRecord || "Ctrl+Shift+R") === preset
                        ? "bg-sky-600 text-white font-semibold"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
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
                Current: v{runningVersion}
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
                  <span>You have the latest version installed (v{runningVersion})!</span>
                </div>
              )}

              {updateStatus === "available" && latestRelease && (
                <div className="space-y-2.5 bg-orange-950/30 p-3 rounded-lg border border-orange-700/40 text-[11px]">
                  <div className="flex items-center justify-between text-orange-300 font-semibold">
                    <span className="text-xs">🎉 New version available: {latestRelease.tag_name}</span>
                    <button
                      onClick={handleOpenReleasePage}
                      className="flex items-center gap-1 text-orange-400 hover:text-orange-200 underline text-[10px]"
                      title="View release notes on GitHub"
                    >
                      <span>GitHub</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  {latestRelease.body && (
                    <p className="text-zinc-400 line-clamp-3 text-[10px] whitespace-pre-line bg-zinc-950/60 p-2 rounded border border-zinc-800/50">
                      {latestRelease.body}
                    </p>
                  )}

                  {/* 1-Click Update Button & Browser Download */}
                  <div className="pt-1 flex flex-col gap-1.5">
                    <button
                      onClick={handleDownloadAndInstall}
                      disabled={isDownloading}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-[#F36F21] hover:bg-[#ff7d33] active:bg-[#d95d14] disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-lg shadow-orange-600/25 transition-all"
                    >
                      <Download className={`w-3.5 h-3.5 ${isDownloading ? "animate-bounce" : ""}`} />
                      <span>
                        {isDownloading ? "Downloading & Launching Update..." : "Download & Install Update Now"}
                      </span>
                    </button>

                    <button
                      onClick={handleOpenReleasePage}
                      className="w-full py-1.5 text-zinc-400 hover:text-zinc-200 text-[10px] flex items-center justify-center gap-1 hover:underline"
                    >
                      <span>Or download Portable (.exe) via Browser</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  {downloadMessage && (
                    <div className="text-center text-[10px] text-emerald-400 font-medium">
                      {downloadMessage}
                    </div>
                  )}
                </div>
              )}

              {updateStatus === "error" && (
                <div className="space-y-2 bg-amber-950/40 p-2.5 rounded-lg border border-amber-800/40 text-[11px]">
                  <div className="flex items-center gap-1.5 text-amber-400">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{updateError || "Could not reach GitHub Releases."}</span>
                  </div>
                  <button
                    onClick={handleOpenReleasePage}
                    className="w-full py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 border border-zinc-700 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[#F36F21]" />
                    <span>Open GitHub Download Page in Browser</span>
                  </button>
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
