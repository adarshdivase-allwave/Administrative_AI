import * as React from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Plus, ShoppingCart, XCircle } from "lucide-react";
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
import { MoneyInput } from "@/components/fields/money-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useCrud } from "@/hooks/use-crud";
import { useAuthStore } from "@/stores/auth-store";
import { SUPPORTED_CURRENCIES, type Currency } from "@shared/constants";
import { formatInr } from "@shared/currency";
import { formatIST, fyShort } from "@shared/fy";

const schema = z.object({
  poNumber: z.string().min(3, "Required"),
  poDate: z.string().min(1, "Required"),
  vendorId: z.string().min(1, "Required"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("INR"),
  totalValueInr: z.coerce.number().min(0).default(0),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
});
type PoForm = z.infer<typeof schema>;

interface Po extends PoForm {
  id: string;
  approvalStatus?: string;
  status?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  rejectionReason?: string;
  sentToVendorAt?: string;
}
interface Vendor { id: string; name: string }

export function PurchaseOrdersPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const isPurchase = useAuthStore((s) => s.hasRole(["Admin", "Purchase"]));
  const crud = useCrud<Po>("PurchaseOrder");
  const vendors = useCrud<Vendor>("Vendor");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Po | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<Po | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const vendorById = useMemo(
    () => new Map(vendors.data.map((v) => [v.id, v])),
    [vendors.data],
  );

  // Approval threshold from env (would come from SystemSettings in production).
  const approvalThreshold = 50000;

  const form = useForm<PoForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      poNumber: `PO-${fyShort(new Date())}-${String(Date.now()).slice(-5)}`,
      poDate: new Date().toISOString().slice(0, 10),
      vendorId: "",
      currency: "INR",
      totalValueInr: 0,
    },
  });

  function openCreate() {
    form.reset({
      poNumber: `PO-${fyShort(new Date())}-${String(Date.now()).slice(-5)}`,
      poDate: new Date().toISOString().slice(0, 10),
      vendorId: "",
      currency: "INR",
      totalValueInr: 0,
    });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }
  function openEdit(p: Po) {
    form.reset(p);
    setEditing(p);
    setMode("edit");
    setDrawerOpen(true);
  }

  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    const payload = {
      ...values,
      approvalStatus:
        values.totalValueInr >= approvalThreshold ? "PENDING_APPROVAL" : "AUTO_APPROVED",
      status: "DRAFT",
    };
    if (mode === "create") {
      if (await crud.create(payload as never)) setDrawerOpen(false);
    } else if (editing) {
      if (await crud.update(editing.id, payload)) setDrawerOpen(false);
    }
  }

  async function approve(po: Po) {
    await crud.update(po.id, {
      approvalStatus: "APPROVED",
      approvedAt: new Date().toISOString(),
      status: "SENT_TO_VENDOR",
      sentToVendorAt: new Date().toISOString(),
    });
  }
  async function reject(po: Po, reason: string) {
    await crud.update(po.id, {
      approvalStatus: "REJECTED",
      rejectionReason: reason,
    });
  }

  const columns: ColumnDef<Po>[] = [
    {
      accessorKey: "poNumber",
      header: "PO #",
      cell: ({ getValue }) => <span className="font-mono text-xs font-medium">{String(getValue())}</span>,
    },
    {
      accessorKey: "poDate",
      header: "Date",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return <span className="text-xs">{v ? formatIST(new Date(v)) : "—"}</span>;
      },
    },
    {
      accessorKey: "vendorId",
      header: "Vendor",
      cell: ({ getValue }) => (
        <span className="text-xs">{vendorById.get(getValue() as string)?.name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "totalValueInr",
      header: () => <div className="text-right">Value</div>,
      cell: ({ getValue }) => (
        <div className="text-right font-mono text-xs">
          {formatInr(Number(getValue() ?? 0), { showSymbol: false })}
        </div>
      ),
    },
    {
      accessorKey: "approvalStatus",
      header: "Approval",
      cell: ({ getValue }) => {
        const s = (getValue() as string) ?? "AUTO_APPROVED";
        const variant: "default" | "secondary" | "destructive" | "warning" | "success" =
          s === "APPROVED" ? "success" : s === "REJECTED" ? "destructive" : s === "PENDING_APPROVAL" ? "warning" : "secondary";
        return <Badge variant={variant} className="text-[10px]">{s.replace(/_/g, " ")}</Badge>;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const s = (getValue() as string) ?? "DRAFT";
        return <Badge variant="outline" className="text-[10px]">{s.replace(/_/g, " ")}</Badge>;
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {isAdmin && row.original.approvalStatus === "PENDING_APPROVAL" && (
            <Button size="sm" variant="ghost" onClick={() => setApprovalTarget(row.original)}>
              Review
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase orders"
        description={`POs ≥ ${formatInr(approvalThreshold)} require Admin approval before they're sent to the vendor.`}
        breadcrumbs={[{ label: "Procurement" }, { label: "Purchase orders" }]}
        actions={
          isPurchase && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> New PO
            </Button>
          )
        }
      />

      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search PO #..."
        emptyTitle="No POs yet"
        emptyDescription="Create your first purchase order or use the BOQ upload flow."
        emptyAction={
          isPurchase && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New PO
            </Button>
          )
        }
        onRowClick={openEdit}
        initialSorting={[{ id: "poDate", desc: true }]}
      />

      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="purchase order"
        description={`POs ≥ ${formatInr(approvalThreshold)} auto-route to Admin approval.`}
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" /> Header
          </div>
          <Labeled label="PO number *">
            <Input className="font-mono" {...form.register("poNumber")} />
            {form.formState.errors.poNumber && <p className="text-[11px] text-destructive">{form.formState.errors.poNumber.message}</p>}
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="PO date *">
              <Input type="date" {...form.register("poDate")} />
            </Labeled>
            <Labeled label="Expected delivery">
              <Input type="date" {...form.register("expectedDeliveryDate")} />
            </Labeled>
          </div>
          <Labeled label="Vendor *">
            <Select value={form.watch("vendorId")} onValueChange={(v) => form.setValue("vendorId", v, { shouldValidate: true })}>
              <SelectTrigger><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.data.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Currency">
              <Select value={form.watch("currency")} onValueChange={(v) => form.setValue("currency", v as Currency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
            <MoneyInput
              label="Total value (INR)"
              {...form.register("totalValueInr")}
              value={form.watch("totalValueInr")}
            />
          </div>
          {form.watch("totalValueInr") >= approvalThreshold && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-warning-foreground">
              This PO will require Admin approval.
            </div>
          )}
        </Card>
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Notes</div>
          <Textarea rows={3} {...form.register("notes")} />
        </Card>
      </EntityDrawer>

      {/* Approval dialog */}
      <Dialog open={Boolean(approvalTarget)} onOpenChange={(v) => !v && setApprovalTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Review PO {approvalTarget?.poNumber}
            </DialogTitle>
            <DialogDescription>
              {vendorById.get(approvalTarget?.vendorId ?? "")?.name} ·{" "}
              {approvalTarget?.totalValueInr ? formatInr(approvalTarget.totalValueInr) : "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Approving will mark the PO as <strong>SENT_TO_VENDOR</strong> and stamp the approval timestamp. (Email-to-vendor workflow is backend-ready.)
            </p>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Rejection reason (required for reject)"
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!rejectReason.trim()) { toast.error("Add a rejection reason"); return; }
                if (approvalTarget) await reject(approvalTarget, rejectReason);
                setApprovalTarget(null);
                setRejectReason("");
              }}
            >
              <XCircle className="h-4 w-4" /> Reject
            </Button>
            <Button
              onClick={async () => {
                if (approvalTarget) await approve(approvalTarget);
                setApprovalTarget(null);
                setRejectReason("");
              }}
            >
              <CheckCircle2 className="h-4 w-4" /> Approve + send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
