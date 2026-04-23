import { NavLink } from "react-router-dom";
import { ChevronLeft, Boxes } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { NAV_ITEMS, NAV_GROUPS } from "./nav-config";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { env } from "@/lib/env";

export function Sidebar() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const groups = useAuthStore((s) => s.user?.groups ?? []);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r bg-card transition-[width] duration-200 ease-out",
        sidebarCollapsed ? "w-[68px]" : "w-[240px]",
      )}
    >
      <div className="flex h-14 items-center justify-between px-4 border-b">
        <div className="flex items-center gap-2 overflow-hidden">
          <Boxes className="h-5 w-5 text-primary flex-shrink-0" />
          {!sidebarCollapsed && (
            <span className="truncate text-sm font-semibold">{env.companyName}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="h-7 w-7"
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 transition-transform",
              sidebarCollapsed && "rotate-180",
            )}
          />
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4" aria-label="Main">
        {NAV_GROUPS.map((group) => {
          const items = NAV_ITEMS.filter(
            (i) => i.group === group && i.roles.some((r) => groups.includes(r)),
          );
          if (items.length === 0) return null;
          return (
            <div key={group} className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {group}
                </div>
              )}
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      isActive && "bg-accent text-accent-foreground font-medium",
                      sidebarCollapsed && "justify-center px-0",
                    )
                  }
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                  {!sidebarCollapsed && <span className="flex-1 truncate">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <Separator />
      {!sidebarCollapsed && (
        <div className="p-3 text-[11px] text-muted-foreground">
          <p>v5.0 • {env.appEnv.toUpperCase()}</p>
          <p className="mt-0.5">FY label updates on April 1</p>
        </div>
      )}
    </aside>
  );
}
