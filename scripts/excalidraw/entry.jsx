// Build-time React host for the Excalidraw editor. esbuild bundles this (plus
// React and Excalidraw) into public/vendor/excalidraw/excalidraw.js — a single
// self-contained IIFE the build-less app serves statically. See
// scripts/build-excalidraw.mjs. The app talks to it only through the global
// window.ROLExcalidraw.open({...}) defined at the bottom; no React leaks out.
import React, { useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, exportToBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

function Editor({ initialData, onSave, onCancel, title }) {
  const apiRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSave = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      // The editable scene we round-trip on next open, and a flat PNG handout.
      const sceneJson = serializeAsJSON(elements, appState, files, "local");
      const blob = await exportToBlob({
        elements,
        appState: { ...appState, exportBackground: true, exportEmbedScene: false },
        files,
        mimeType: "image/png",
        quality: 1,
      });
      await onSave({ sceneJson, blob });
    } catch (e) {
      setError((e && e.message) || "Save failed");
      setBusy(false);
    }
  }, [onSave]);

  return (
    <div className="rol-exc-overlay">
      <div className="rol-exc-toolbar">
        <span className="rol-exc-title">{title || "Diagram"}</span>
        {error ? <span className="rol-exc-error">{error}</span> : null}
        <span className="rol-exc-spacer" />
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="primary" onClick={handleSave} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="rol-exc-canvas">
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; }}
          initialData={initialData}
        />
      </div>
    </div>
  );
}

// Single entry point the app calls. Mounts a full-screen editor; resolves the
// caller's onSave({ sceneJson, blob }) then tears the React tree back down.
window.ROLExcalidraw = {
  open({ scene, title, onSave }) {
    const host = document.createElement("div");
    host.className = "rol-exc-host";
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = () => { root.unmount(); host.remove(); };

    let initialData = null;
    if (scene) {
      try {
        initialData = typeof scene === "string" ? JSON.parse(scene) : scene;
      } catch (_) {
        initialData = null;
      }
    }

    root.render(
      React.createElement(Editor, {
        title,
        initialData,
        onCancel: close,
        onSave: async (payload) => {
          await onSave(payload);
          close();
        },
      })
    );
  },
};
