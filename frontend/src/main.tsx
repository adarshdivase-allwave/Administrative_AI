import "./styles/globals.css";
import "@/lib/amplify-client"; // configures Amplify as a side effect
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useUIStore } from "@/stores/ui-store";

// Apply persisted theme before first paint to avoid FOUC.
const persisted = JSON.parse(localStorage.getItem("av-inventory-ui") ?? "null") as
  | { state?: { theme?: "light" | "dark" | "system" } }
  | null;
const theme = persisted?.state?.theme ?? "system";
if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark");
}
// Still call the store applier so the <html> class + system listener sync up.
queueMicrotask(() => useUIStore.getState().setTheme(theme));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
