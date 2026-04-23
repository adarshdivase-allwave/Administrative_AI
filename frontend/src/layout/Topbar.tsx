import { Search, Command as CmdIcon, Moon, Sun, Bell, Monitor, LogOut, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { fyLabel } from "@shared/fy";

/**
 * Top bar: breadcrumb / page title (title rendered by each page — we just
 * provide the shell), global Cmd+K trigger, theme toggle, notifications
 * placeholder, and the user menu.
 */
export function Topbar() {
  const setCommandPalette = useUIStore((s) => s.setCommandPalette);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const user = useAuthStore((s) => s.user);
  const doSignOut = useAuthStore((s) => s.signOut);

  const fy = fyLabel(new Date());

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/70 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCommandPalette(true)}
        className="hidden md:inline-flex gap-2 text-muted-foreground w-[320px] justify-start"
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search serials, projects, clients...</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
          <CmdIcon className="h-3 w-3" />K
        </kbd>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCommandPalette(true)}
        className="md:hidden"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Badge variant="outline" className="hidden sm:inline-flex font-mono" title="Current financial year (India)">
          {fy}
        </Badge>

        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme">
              {theme === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : theme === "system" ? (
                <Monitor className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={theme === "light"}
              onCheckedChange={() => setTheme("light")}
            >
              <Sun className="mr-2 h-4 w-4" /> Light
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={theme === "dark"}
              onCheckedChange={() => setTheme("dark")}
            >
              <Moon className="mr-2 h-4 w-4" /> Dark
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={theme === "system"}
              onCheckedChange={() => setTheme("system")}
            >
              <Monitor className="mr-2 h-4 w-4" /> System
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <UserCircle className="h-5 w-5" />
              <span className="hidden sm:inline">{user?.email ?? "Signed in"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{user?.email}</span>
                <span className="text-xs text-muted-foreground">
                  Role: {user?.role ?? "—"}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => doSignOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
