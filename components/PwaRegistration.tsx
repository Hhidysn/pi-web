"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
    // Production registers the offline worker that serves the app. Development
    // registers a push-only one: `next dev` must own chunks and HMR, but a
    // backgrounded or locked phone still needs a worker to receive the run's
    // completion notification (the in-page chime needs a visible page).
    const pushOnly = process.env.NODE_ENV !== "production";
    const params = new URLSearchParams({ v: appVersion });
    if (pushOnly) params.set("mode", "push-only");
    const scriptUrl = `/sw.js?${params.toString()}`;

    const register = () => {
      void navigator.serviceWorker.register(scriptUrl, {
        scope: "/",
        updateViaCache: "none",
      }).catch((error: unknown) => {
        console.error("Failed to register the Pi Web service worker:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
