import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Search, ArrowUpDown, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * Reusable table that powers every list page. Not virtualized by default
 * (that's a separate `<VirtualTable>` used by Inventory for 50k+ rows);
 * this one is for typical CRUD lists under ~1000 rows.
 *
 * Features:
 *   - Global search
 *   - Column sort (click header)
 *   - Pagination (page size 20, configurable)
 *   - Loading + empty states baked in
 *   - Row-click callback
 *   - Mobile-friendly (becomes stack of cards on narrow screens)
 */
interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  initialSorting?: SortingState;
  pageSize?: number;
  enableGlobalFilter?: boolean;
}

export function DataTable<T>({
  data,
  columns,
  loading,
  error,
  emptyTitle = "Nothing to show yet",
  emptyDescription = "Create your first record to get started.",
  emptyAction,
  searchPlaceholder = "Search...",
  onRowClick,
  initialSorting,
  pageSize = 20,
  enableGlobalFilter = true,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting ?? []);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize },
    },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      {enableGlobalFilter && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
        </div>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className="h-10 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <ArrowUpDown className="h-3 w-3 opacity-60" />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {columns.map((_c, j) => (
                      <td key={j} className="p-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    <div className="mx-auto max-w-xs space-y-2">
                      <p className="font-medium text-foreground">{emptyTitle}</p>
                      <p>{emptyDescription}</p>
                      {emptyAction && <div className="pt-2">{emptyAction}</div>}
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b transition-colors hover:bg-accent/40",
                      onRowClick && "cursor-pointer",
                    )}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {!loading && rows.length > 0 && (
          <div className="flex items-center justify-between border-t p-2 text-xs text-muted-foreground">
            <div>
              Showing <span className="font-medium text-foreground">{rows.length}</span> of{" "}
              <span className="font-medium text-foreground">
                {table.getFilteredRowModel().rows.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span>
                Page {table.getState().pagination.pageIndex + 1} of{" "}
                {Math.max(1, table.getPageCount())}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Thin loading spinner, e.g. inline in a button. */
export function InlineSpinner(props: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", props.className)} />;
}
