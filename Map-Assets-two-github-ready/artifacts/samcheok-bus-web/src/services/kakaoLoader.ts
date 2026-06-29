import { useEffect, useState } from "react";

export type KakaoStatus = "loading" | "ready" | "error";
export type KakaoErrorReason = "missing-key" | "load-failed" | null;

export interface KakaoState {
  status: KakaoStatus;
  reason: KakaoErrorReason;
}

let loadPromise: Promise<void> | null = null;
let loadReason: KakaoErrorReason = null;

function getRawKey(): string {
  const key = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;
  return typeof key === "string" ? key.trim() : "";
}

function maskKey(key: string): string {
  if (!key) return "(none)";
  return `${key.slice(0, 4)}****`;
}

export function isKakaoConfigured(): boolean {
  return getRawKey().length > 0;
}

export function getKakaoErrorReason(): KakaoErrorReason {
  return loadReason;
}

export function loadKakaoMaps(): Promise<void> {
  if (loadPromise) return loadPromise;

  const key = getRawKey();
  if (!key) {
    loadReason = "missing-key";
    console.error(
      "[KakaoMaps] appkey is undefined/empty — VITE_KAKAO_JAVASCRIPT_KEY is missing from the build environment.",
    );
    loadPromise = Promise.reject(new Error("missing-key"));
    return loadPromise;
  }

  const sdkUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
  const maskedUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${maskKey(
    key,
  )}&autoload=false`;

  loadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window !== "undefined" && window.kakao?.maps) {
      resolve();
      return;
    }

    const handleError = () => {
      loadReason = "load-failed";
      console.error(
        `[KakaoMaps] SDK script failed to load. url=${maskedUrl} errorType=script-load-error. ` +
          `Most common cause: HTTP 401 "domain mismatched" — register the current domain in the Kakao console Web platform.`,
      );
      reject(new Error("load-failed"));
    };

    const existing = document.getElementById(
      "kakao-maps-sdk",
    ) as HTMLScriptElement | null;

    const onScriptLoad = () => {
      try {
        window.kakao.maps.load(() => resolve());
      } catch (err) {
        loadReason = "load-failed";
        console.error(
          `[KakaoMaps] SDK loaded but maps.load() threw. url=${maskedUrl}`,
          err,
        );
        reject(err);
      }
    };

    if (existing) {
      existing.addEventListener("load", onScriptLoad);
      existing.addEventListener("error", handleError);
      return;
    }

    const script = document.createElement("script");
    script.id = "kakao-maps-sdk";
    script.async = true;
    script.src = sdkUrl;
    script.addEventListener("load", onScriptLoad);
    script.addEventListener("error", handleError);
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function useKakaoMaps(): KakaoState {
  const [state, setState] = useState<KakaoState>(() =>
    isKakaoConfigured()
      ? { status: "loading", reason: null }
      : { status: "error", reason: "missing-key" },
  );

  useEffect(() => {
    let cancelled = false;
    if (!isKakaoConfigured()) {
      setState({ status: "error", reason: "missing-key" });
      return;
    }
    loadKakaoMaps()
      .then(() => {
        if (!cancelled) setState({ status: "ready", reason: null });
      })
      .catch(() => {
        if (!cancelled)
          setState({
            status: "error",
            reason: getKakaoErrorReason() ?? "load-failed",
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
