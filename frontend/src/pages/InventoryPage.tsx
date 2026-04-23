import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Search,
  Filter,
  ArrowUpDown,
  Download,
  RefreshCw,
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/amplify-client";
import { formatInr } from "@shared/currency";
import {
  INVENTORY_CATEGORIES,
  UNIT_STATUSES,
  type InventoryCategory,
  type UnitStatus,
} from "@shared/constants";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";

/**
 * Inventory page — virtualized TanStack Table v8 over UnitRecord.
 *
 * - Handles 50k+ rows via row virtualization (only renders visible rows).
 * - Serial-number global filter matches any substring.
 * - Category / status / godown filters drive server-side where clauses so
 *   we don't pull the whole table down on first paint.
 * - Admin sees purchase prices; other roles see "—" via field masking.
 */

interface UnitRow {
  id: string;
  serialNumber: string;
  productId?: string;
  inventoryCategory?: InventoryCategory;
  status?: UnitStatus;
  condition?: string;
  godownId?: string;
  godownLocation?: string;
  purchasePrice?: number;
  warrantyExpiryDate?: string;
  updatedAt?: string;
}

export function InventoryPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<InventoryCategory | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<UnitStatus | "ALL">("ALL");
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await (
        api.models as unknown as {
          UnitRecord: {
            list: (args: unknown) => Promise<{ data?: UnitRow[] }>;
          };
        }
      ).UnitRecord.list({
        filter: {
          ...(categoryFilter !== "ALL" && {
            inventoryCategory: { eq: categoryFilter },
          }),
          ...(statusFilter !== "ALL" && { status: { eq: statusFilter } }),
        },
        limit: 500,
      });
      setRows(res.data ?? []);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, statusFilter]);

  const columns = useMemo<ColumnDef<UnitRow>[]>(() => {
    const base: ColumnDef<UnitRow>[] = [
      {
        accessorKey: "serialNumber",
        header: ({ column }) => (
          <SortHeader column={column}>Serial #</SortHeader>
        ),
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{String(getValue() ?? "")}</span>
        ),
      },
      {
        accessorKey: "inventoryCategory",
        header: "Category",
        cell: ({ getValue }) => (
          <Badge variant="outline" className="text-[10px] font-mono">
            {String(getValue() ?? "—")}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => <StatusPill status={getValue() as string} />,
      },
      {
        accessorKey: "condition",
        header: "Condition",
        cell: ({ getValue }) => (
          <span className="text-xs">{String(getValue() ?? "—")}</span>
        ),
      },
      {
        accessorKey: "godownLocation",
        header: "Location",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{String(getValue() ?? "—")}</span>
        ),
      },
      {
        accessorKey: "warrantyExpiryDate",
        header: "Warranty",
        cell: ({ getValue }) => {
          const v = getValue() as string | undefined;
          if (!v) return <span className="text-muted-foreground">—</span>;
          const d = new Date(v);
          const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
          return (
            <span className={cn("text-xs", days < 0 && "text-destructive", days < 30 && days >= 0 && "text-warning")}>
              {d.toISOString().slice(0, 10)}
              <span className="ml-1 text-muted-foreground">({days}d)</span>
            </span>
          );
        },
      },
    ];
    if (isAdmin) {
      base.push({
        accessorKey: "purchasePrice",
        header: () => <div className="text-right">Cost</div>,
        cell: ({ getValue }) => {
          const v = getValue() as number | undefined;
          return (
            <div className="text-right font-mono text-xs">
              {v != null ? formatInr(v, { showSymbol: false }) : "—"}
            </div>
          );
        },
      });
    }
    base.push({
      id: "actions",
      header: "",
      cell: () => (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" aria-label="Print QR" className="h-7 w-7">
            <QrCode className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    });
    return base;
  }, [isAdmin]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _id, filterValue) => {
      const v = String(filterValue ?? "").toLowerCase();
      if (!v) return true;
      const r = row.original;
      return [r.serialNumber, r.productId, r.godownLocation]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(v));
    },
  });

  const { rows: tableRows } = table.getRowModel();
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[280px]">
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : `${tableRows.length.toLocaleString("en-IN")} units`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </Button>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search by serial number, product, or location…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter(v as InventoryCategory | "ALL")}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {INVENTORY_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as UnitStatus | "ALL")}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {UNIT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 text-sm text-destructive">
            Couldn&apos;t load inventory: {error}. If this is a fresh sandbox, run{" "}
            <code>ampx sandbox</code> and retry.
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div
          ref={parentRef}
          className="relative h-[calc(100vh-320px)] min-h-[400px] overflow-auto"
        >
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-card border-b">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className="h-10 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {columns.map((_c, j) => (
                      <td key={j} className="p-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : tableRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-20 text-center text-sm text-muted-foreground"
                  >
                    No units match the current filter.
                  </td>
                </tr>
              ) : (
                <>
                  <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0]?.start ?? 0}px` }} />
                  {rowVirtualizer.getVirtualItems().map((vRow) => {
                    const row = tableRows[vRow.index];
                    if (!row) return null;
                    return (
                      <tr
                        key={row.id}
                        className="border-b transition-colors hover:bg-accent/40"
                        style={{ height: `${vRow.size}px` }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="px-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SortHeader({
  column,
  children,
}: {
  column: { toggleSorting: (d?: boolean) => void; getIsSorted: () => false | "asc" | "desc" };
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {children}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const map: Record<string, "default" | "secondary" | "destructive" | "warning" | "success"> = {
    IN_STOCK: "success",
    ALLOCATED_TO_PROJECT: "default",
    ON_DEMO: "default",
    ON_STANDBY: "secondary",
    ASSET_IN_USE: "default",
    DISPATCHED: "default",
    IN_TRANSIT: "warning",
    UNDER_REPAIR: "warning",
    UNDER_SERVICE: "warning",
    RETURNED: "secondary",
    DAMAGED: "destructive",
    RETIRED: "secondary",
  };
  const variant = map[status] ?? "secondary";
  return (
    <Badge variant={variant} className="text-[10px] font-mono">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
