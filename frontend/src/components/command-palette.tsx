import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { NAV_ITEMS, NAV_GROUPS } from "@/layout/nav-config";

/**
 * Cmd+K / Ctrl+K command palette. Wires to the UI store for visibility.
 * Entity search (products, serials, clients, vendors) wires to an
 * AppSync query that hits OpenSearch — implemented as a follow-up iteration.
 * For now we surface navigation entries matched against the user's role.
 */
export function CommandPalette() {
  const nav = useNavigate();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPalette);
  const groups = useAuthStore((s) => s.user?.groups ?? []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const visibleItems = useMemo(
    () => NAV_ITEMS.filter((i) => i.roles.some((r) => groups.includes(r))),
    [groups],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Command palette"
    >
      <div
        className="mx-auto mt-[15vh] max-w-xl rounded-xl border bg-popover shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <Command loop>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input
              placeholder="Search serials, products, clients, vendors..."
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          <Command.List className="max-h-[min(420px,50vh)] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No matches.
            </Command.Empty>

            {NAV_GROUPS.map((group) => {
              const items = visibleItems.filter((i) => i.group === group);
              if (!items.length) return null;
              return (
                <Command.Group
                  key={group}
                  heading={group}
                  className="px-1 py-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold"
                >
                  {items.map((item) => (
                    <Command.Item
                      key={item.to}
                      value={`${item.label} ${item.to}`}
                      onSelect={() => {
                        setOpen(false);
                        nav(item.to);
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm",
                        "aria-selected:bg-accent aria-selected:text-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="text-[10px] text-muted-foreground font-mono">
                          {item.shortcut}
                        </kbd>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>

          <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              <kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> to select
              &nbsp;·&nbsp;
              <kbd className="rounded border bg-muted px-1 font-mono">↑↓</kbd> to navigate
              &nbsp;·&nbsp;
              <kbd className="rounded border bg-muted px-1 font-mono">Esc</kbd> to close
            </span>
            <span>Full entity search coming in a follow-up</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
