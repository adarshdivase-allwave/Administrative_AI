import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SessionExpiryMonitor } from "@/auth/SessionExpiryMonitor";
import { CommandPalette } from "@/components/command-palette";
import { ChatbotWidget } from "@/components/chatbot-widget";
import { env } from "@/lib/env";

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <div className="container py-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global overlays */}
      <SessionExpiryMonitor />
      <CommandPalette />
      {env.chatbotEnabled && <ChatbotWidget />}
    </div>
  );
}
