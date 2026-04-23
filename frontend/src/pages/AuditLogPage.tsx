import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Download, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCrud } from "@/hooks/use-crud";
import { formatIST } from "@shared/fy";

interface AuditRow {
  id: string;
  actorUserId?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  occurredAt?: string;
}

export function AuditLogPage() {
  const crud = useCrud<AuditRow>("AuditLog", { limit: 500 });
  const [inspect, setInspect] = useState<AuditRow | null>(null);

  const columns: ColumnDef<AuditRow>[] = [
    {
      accessorKey: "occurredAt",
      header: "When",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        if (!v) return <span className="text-muted-foreground">—</span>;
        const d = new Date(v);
        return (
          <div className="text-xs">
            <div>{formatIST(d)}</div>
            <div className="text-[10px] text-muted-foreground">
              {d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "actorRole",
      header: "Actor",
      cell: ({ row }) => (
        <div className="text-xs">
          <Badge variant="outline" className="text-[10px]">
            {row.original.actorRole ?? "SYSTEM"}
          </Badge>
          <div className="font-mono text-[10px] text-muted-foreground mt-1">
            {row.original.actorUserId?.slice(0, 12) ?? "—"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-medium">{String(getValue())}</span>
      ),
    },
    {
      accessorKey: "entityType",
      header: "Entity",
      cell: ({ row }) => (
        <div className="text-xs">
          <div>{row.original.entityType}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {row.original.entityId?.slice(0, 12) ?? ""}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "ip",
      header: "IP",
      cell: ({ getValue }) => (
        <span className="font-mono text-[10px] text-muted-foreground">
          {(getValue() as string) ?? "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => setInspect(row.original)}>
            Inspect
          </Button>
        </div>
      ),
    },
  ];

  function exportCsv() {
    const header = ["occurredAt", "actorRole", "actorUserId", "action", "entityType", "entityId", "ip"];
    const rows = [header, ...crud.data.map((r) => header.map((k) => (r as unknown as Record<string, unknown>)[k] ?? ""))];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="Append-only record of every mutation. Admins can inspect before / after payloads but cannot delete entries."
        breadcrumbs={[{ label: "Admin" }, { label: "Audit log" }]}
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={crud.data.length === 0}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />
      <div className="rounded-md bg-muted/40 p-3 text-xs flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-success" />
        <span>
          {crud.data.length} audit entries. Table has no delete permission for any role — tampering isn't possible.
        </span>
      </div>
      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search by action, entity, user..."
        emptyTitle="No audit entries yet"
        emptyDescription="Every mutation made through the app appears here automatically."
        initialSorting={[{ id: "occurredAt", desc: true }]}
      />
      <Dialog open={Boolean(inspect)} onOpenChange={(v) => !v && setInspect(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{inspect?.action}</DialogTitle>
            <DialogDescription>
              {inspect?.entityType} · {inspect?.entityId ?? ""} ·{" "}
              {inspect?.occurredAt ? formatIST(new Date(inspect.occurredAt)) : ""}
            </DialogDescription>
          </DialogHeader>
          {inspect && (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              <DiffPane label="Before" data={inspect.before} />
              <DiffPane label="After" data={inspect.after} />
              <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <div>Actor: {inspect.actorUserId ?? "SYSTEM"} ({inspect.actorRole ?? "—"})</div>
                <div>IP: {inspect.ip ?? "—"}</div>
                <div>User agent: {inspect.userAgent ?? "—"}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DiffPane({ label, data }: { label: string; data?: Record<string, unknown> }) {
  if (!data) return null;
  return (
    <div className="rounded-md border">
      <div className="border-b bg-muted/40 px-3 py-1 text-[11px] font-medium">{label}</div>
      <pre className="p-3 text-[11px] font-mono overflow-x-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
