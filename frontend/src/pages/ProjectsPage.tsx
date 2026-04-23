import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useCrud } from "@/hooks/use-crud";
import { useAuthStore } from "@/stores/auth-store";
import { formatIST } from "@shared/fy";

const PROJECT_STATUSES = ["PLANNING", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;

const schema = z.object({
  projectName: z.string().min(2, "Required"),
  clientId: z.string().min(1, "Required"),
  projectCode: z.string().optional(),
  siteAddressLine1: z.string().optional(),
  siteCity: z.string().optional(),
  siteState: z.string().optional(),
  sitePincode: z.string().regex(/^[1-9][0-9]{5}$/, "6-digit pincode").optional().or(z.literal("")),
  startDate: z.string().optional(),
  expectedEndDate: z.string().optional(),
  actualEndDate: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).default("PLANNING"),
  notes: z.string().optional(),
});
type ProjectFormValues = z.infer<typeof schema>;
interface Project extends ProjectFormValues {
  id: string;
}
interface Client {
  id: string;
  name: string;
}

export function ProjectsPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const crud = useCrud<Project>("Project");
  const clients = useCrud<Client>("Client");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { projectName: "", clientId: "", status: "PLANNING" },
  });

  function openCreate() {
    form.reset({ projectName: "", clientId: "", status: "PLANNING" });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }
  function openEdit(p: Project) {
    form.reset(p);
    setEditing(p);
    setMode("edit");
    setDrawerOpen(true);
  }
  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    const cleaned = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== "" && v !== undefined),
    ) as ProjectFormValues;
    if (mode === "create") {
      if (await crud.create(cleaned as never)) setDrawerOpen(false);
    } else if (editing) {
      if (await crud.update(editing.id, cleaned)) setDrawerOpen(false);
    }
  }

  const clientById = new Map(clients.data.map((c) => [c.id, c]));

  const columns: ColumnDef<Project>[] = [
    {
      accessorKey: "projectName",
      header: "Project",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.projectName}</div>
          {row.original.projectCode && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {row.original.projectCode}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "clientId",
      header: "Client",
      cell: ({ getValue }) => (
        <span className="text-xs">{clientById.get(getValue() as string)?.name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const s = getValue() as string;
        const variant: "default" | "secondary" | "warning" | "success" =
          s === "COMPLETED" ? "success" : s === "IN_PROGRESS" ? "default" : s === "ON_HOLD" ? "warning" : "secondary";
        return <Badge variant={variant}>{s.replace(/_/g, " ")}</Badge>;
      },
    },
    {
      accessorKey: "startDate",
      header: "Start",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return <span className="text-xs">{v ? formatIST(new Date(v)) : "—"}</span>;
      },
    },
    {
      accessorKey: "expectedEndDate",
      header: "Expected end",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return <span className="text-xs">{v ? formatIST(new Date(v)) : "—"}</span>;
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row.original)} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(row.original)} aria-label="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        description="Client engagements. Units allocated to a project via DC have category = PROJECT."
        breadcrumbs={[{ label: "Finance" }, { label: "Projects" }]}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New project
          </Button>
        }
      />
      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search projects..."
        emptyTitle="No projects yet"
        emptyDescription="Create a project and assign it a client to start tracking allocated units."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Add project</Button>}
        onRowClick={openEdit}
      />
      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="project"
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Briefcase className="h-4 w-4 text-muted-foreground" /> Project
          </div>
          <Labeled label="Name *">
            <Input {...form.register("projectName")} />
            {form.formState.errors.projectName && <p className="text-[11px] text-destructive">{form.formState.errors.projectName.message}</p>}
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Project code">
              <Input {...form.register("projectCode")} placeholder="JIO-BKC-001" className="font-mono" />
            </Labeled>
            <Labeled label="Status">
              <Select
                value={form.watch("status")}
                onValueChange={(v) => form.setValue("status", v as ProjectFormValues["status"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
          </div>
          <Labeled label="Client *">
            <Select
              value={form.watch("clientId") ?? ""}
              onValueChange={(v) => form.setValue("clientId", v, { shouldValidate: true })}
            >
              <SelectTrigger><SelectValue placeholder={clients.loading ? "Loading…" : "Select a client"} /></SelectTrigger>
              <SelectContent>
                {clients.data.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.clientId && <p className="text-[11px] text-destructive">{form.formState.errors.clientId.message}</p>}
          </Labeled>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Site address</div>
          <Labeled label="Address"><Input {...form.register("siteAddressLine1")} /></Labeled>
          <div className="grid grid-cols-3 gap-3">
            <Labeled label="City"><Input {...form.register("siteCity")} /></Labeled>
            <Labeled label="State"><Input {...form.register("siteState")} /></Labeled>
            <Labeled label="Pincode"><Input {...form.register("sitePincode")} maxLength={6} /></Labeled>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Timeline</div>
          <div className="grid grid-cols-3 gap-3">
            <Labeled label="Start"><Input type="date" {...form.register("startDate")} /></Labeled>
            <Labeled label="Expected end"><Input type="date" {...form.register("expectedEndDate")} /></Labeled>
            <Labeled label="Actual end"><Input type="date" {...form.register("actualEndDate")} /></Labeled>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Notes</div>
          <Textarea rows={3} {...form.register("notes")} />
        </Card>
      </EntityDrawer>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete project "${deleteTarget?.projectName}"?`}
        destructive
        confirmLabel="Delete"
        description="Allocated units remain allocated (use a DC return to release them first)."
        onConfirm={async () => {
          if (deleteTarget) await crud.remove(deleteTarget.id);
        }}
      />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
