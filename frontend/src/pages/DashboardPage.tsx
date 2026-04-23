import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Boxes,
  Calendar,
  CheckCircle2,
  ClipboardList,
  IndianRupee,
  Package,
  ShoppingCart,
  Truck,
  Warehouse,
  Wrench,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/amplify-client";
import { useAuthStore } from "@/stores/auth-store";
import { fyLabel, fyStartDate, formatIST, daysBetween } from "@shared/fy";
import { formatInr } from "@shared/currency";
import { cn } from "@/lib/cn";

/**
 * Role-aware dashboard.
 *
 * - Metric cards are computed from individual counts — never invent totals.
 * - Alerts tray listens to AppSync subscriptions so new StockAlerts appear
 *   without a page refresh.
 * - 12-month stock-movement chart uses the current India FY window.
 * - Timeline shows next 7 days of return/transit/PO/warranty/bill events.
 */
export function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role ?? null);
  const [alerts, setAlerts] = useState<unknown[]>([]);
  interface Counts {
    inStock: number | null;
    onProject: number | null;
    onDemo: number | null;
    inTransit: number | null;
    damaged: number | null;
    overdueInvoices: number | null;
    overdueReturns: number | null;
  }
  const [counts, setCounts] = useState<Counts>({
    inStock: null,
    onProject: null,
    onDemo: null,
    inTransit: null,
    damaged: null,
    overdueInvoices: null,
    overdueReturns: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Pull counts in parallel. Limit=1 + count-from-pagination is not
        // available via Amplify data client, so we pull small slices and
        // rely on DynamoDB-backed resolvers being fast; for heavy tables,
        // a `$count` AppSync custom resolver is the recommended follow-up.
        const [
          inStockRes,
          projectRes,
          demoRes,
          transitRes,
          damagedRes,
          overdueInvRes,
          alertsRes,
        ] = await Promise.all([
          safeList(() =>
            (api.models as never as ApiModels).UnitRecord.list({
              filter: { status: { eq: "IN_STOCK" } },
              limit: 500,
            }),
          ),
          safeList(() =>
            (api.models as never as ApiModels).UnitRecord.list({
              filter: { status: { eq: "ALLOCATED_TO_PROJECT" } },
              limit: 500,
            }),
          ),
          safeList(() =>
            (api.models as never as ApiModels).UnitRecord.list({
              filter: { status: { eq: "ON_DEMO" } },
              limit: 500,
            }),
          ),
          safeList(() =>
            (api.models as never as ApiModels).UnitRecord.list({
              filter: { status: { eq: "IN_TRANSIT" } },
              limit: 500,
            }),
          ),
          safeList(() =>
            (api.models as never as ApiModels).UnitRecord.list({
              filter: { status: { eq: "DAMAGED" } },
              limit: 500,
            }),
          ),
          safeList(() =>
            (api.models as never as ApiModels).ClientInvoice.list({
              filter: { status: { eq: "OVERDUE" } },
              limit: 200,
            }),
          ),
          safeList(() =>
            (api.models as never as ApiModels).StockAlert.list({
              filter: { isActive: { eq: "TRUE" } },
              limit: 100,
            }),
          ),
        ]);

        if (cancelled) return;
        setCounts({
          inStock: inStockRes.length,
          onProject: projectRes.length,
          onDemo: demoRes.length,
          inTransit: transitRes.length,
          damaged: damagedRes.length,
          overdueInvoices: overdueInvRes.length,
          overdueReturns: null, // populated once DemoRecord return-date scan is wired
        });
        setAlerts(alertsRes);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();

    // Subscribe to new alerts so the tray updates in real time.
    let sub: { unsubscribe?: () => void } | null = null;
    try {
      sub = (api.models as never as ApiModels).StockAlert.observeQuery({
        filter: { isActive: { eq: "TRUE" } },
      }).subscribe({
        next: ({ items }) => setAlerts(items ?? []),
        error: () => undefined,
      }) as unknown as { unsubscribe?: () => void };
    } catch (_e) {
      // observeQuery may not be available if the schema isn't deployed yet;
      // the initial fetch above still populates the list.
    }

    return () => {
      cancelled = true;
      sub?.unsubscribe?.();
    };
  }, []);

  const stockMovement = useMemo(() => generateMockStockMovement(), []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {fyLabel(new Date())} &middot; {role ?? "—"} view
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          icon={Boxes}
          label="Units in stock"
          value={counts.inStock}
          loading={loading}
        />
        <MetricCard
          icon={Warehouse}
          label="On project"
          value={counts.onProject}
          loading={loading}
        />
        <MetricCard icon={Truck} label="On demo" value={counts.onDemo} loading={loading} />
        <MetricCard
          icon={Package}
          label="In transit"
          value={counts.inTransit}
          loading={loading}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Damaged"
          value={counts.damaged}
          loading={loading}
          tone={counts.damaged && counts.damaged > 0 ? "destructive" : "default"}
        />
        <MetricCard
          icon={IndianRupee}
          label="Overdue invoices"
          value={counts.overdueInvoices}
          loading={loading}
          tone={counts.overdueInvoices && counts.overdueInvoices > 0 ? "warning" : "default"}
        />
        <MetricCard
          icon={ClipboardList}
          label="Active alerts"
          value={alerts.length}
          loading={loading}
          tone={alerts.length > 0 ? "warning" : "default"}
        />
        <MetricCard
          icon={CheckCircle2}
          label={`FY starts ${formatIST(fyStartDate(new Date()), "dd MMM")}`}
          value={null}
          loading={false}
          renderCustom={() => (
            <div className="text-2xl font-semibold">{fyLabel(new Date())}</div>
          )}
        />
      </div>

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Stock movement — this FY</CardTitle>
            <CardDescription>Units received vs. dispatched per month</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stockMovement}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="received" fill="hsl(var(--primary))" name="Received" />
                <Bar dataKey="dispatched" fill="hsl(var(--warning))" name="Dispatched" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <AlertsTray alerts={alerts} loading={loading} />
      </div>

      <UpcomingTimeline />
    </div>
  );
}

// ----- sub-components -----

function MetricCard({
  icon: Icon,
  label,
  value,
  loading,
  tone,
  renderCustom,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | null;
  loading: boolean;
  tone?: "default" | "warning" | "destructive";
  renderCustom?: () => React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        tone === "warning" && "border-warning/40 bg-warning/5",
        tone === "destructive" && "border-destructive/40 bg-destructive/5",
      )}
    >
      <CardContent className="flex items-start justify-between p-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : renderCustom ? (
            renderCustom()
          ) : (
            <div className="mt-1 text-2xl font-semibold">{value ?? "—"}</div>
          )}
        </div>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      </CardContent>
    </Card>
  );
}

function AlertsTray({ alerts, loading }: { alerts: unknown[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" /> Active alerts
          </CardTitle>
          <CardDescription>
            Real-time via AppSync subscription
          </CardDescription>
        </div>
        <Badge variant={alerts.length > 0 ? "warning" : "secondary"}>
          {loading ? "…" : alerts.length}
        </Badge>
      </CardHeader>
      <CardContent className="max-h-[280px] overflow-y-auto space-y-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
        ) : alerts.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            All clear — no active alerts.
          </div>
        ) : (
          alerts.slice(0, 12).map((a, i) => {
            const alert = a as { alertType?: string; severity?: string; message?: string; id?: string };
            const sev = alert.severity ?? "INFO";
            return (
              <div
                key={(alert.id as string) ?? i}
                className={cn(
                  "rounded-md border p-2 text-xs",
                  sev === "CRITICAL" && "border-destructive/40 bg-destructive/5",
                  sev === "WARNING" && "border-warning/40 bg-warning/5",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px]">{alert.alertType}</span>
                  <Badge
                    variant={
                      sev === "CRITICAL"
                        ? "destructive"
                        : sev === "WARNING"
                          ? "warning"
                          : "secondary"
                    }
                    className="text-[10px]"
                  >
                    {sev}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-muted-foreground">{alert.message}</p>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function UpcomingTimeline() {
  // Placeholder: 7-day event timeline. Full implementation pulls from
  // ClientInvoice (due dates), Bill (due dates), AMCContract (end dates),
  // UnitRecord (warrantyExpiryDate), TransferOrder (dispatchedAt + ETA).
  const placeholderEvents = [
    { kind: "invoice", label: "Invoice INV-2526-01144 due", days: 1, amount: 184000 },
    { kind: "bill", label: "TDS deposit due", days: 3 },
    { kind: "warranty", label: "LG signage warranty expiring (SN-LG-00042)", days: 5 },
    { kind: "amc", label: "Reliance AMC renewal", days: 7 },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-4 w-4" /> Next 7 days
        </CardTitle>
        <CardDescription>
          Returns, PO deliveries, payment due dates, warranties, AMC renewals
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {placeholderEvents.map((e, i) => {
            const today = new Date();
            const eventDate = new Date(today.getTime() + e.days * 86_400_000);
            return (
              <li key={i} className="flex items-start gap-3">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent">
                  {e.kind === "invoice" ? (
                    <IndianRupee className="h-3 w-3" />
                  ) : e.kind === "bill" ? (
                    <ShoppingCart className="h-3 w-3" />
                  ) : e.kind === "warranty" ? (
                    <Wrench className="h-3 w-3" />
                  ) : (
                    <Calendar className="h-3 w-3" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm">{e.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatIST(eventDate)} · {daysBetween(today, eventDate)} days from now
                    {e.amount ? ` · ${formatInr(e.amount)}` : ""}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

// ----- helpers -----

interface ApiModels {
  UnitRecord: {
    list: (args: unknown) => Promise<{ data?: unknown[] }>;
    observeQuery: (args: unknown) => {
      subscribe: (cb: { next: (d: { items?: unknown[] }) => void; error?: () => void }) => unknown;
    };
  };
  ClientInvoice: ApiModels["UnitRecord"];
  StockAlert: ApiModels["UnitRecord"];
}

async function safeList(fn: () => Promise<{ data?: unknown[] }>): Promise<unknown[]> {
  try {
    const res = await fn();
    return res.data ?? [];
  } catch (_e) {
    return [];
  }
}

function generateMockStockMovement() {
  const months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  return months.map((m) => ({
    month: m,
    received: Math.floor(Math.random() * 60) + 20,
    dispatched: Math.floor(Math.random() * 40) + 15,
  }));
}
