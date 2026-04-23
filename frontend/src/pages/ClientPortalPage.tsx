import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Boxes,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
} from "lucide-react";
import { api } from "@/lib/amplify-client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatIST } from "@shared/fy";
import { env } from "@/lib/env";

/**
 * Public, token-authenticated client portal.
 *
 * URL: `/portal/:projectId?t=<token>`
 *
 * This page lives OUTSIDE the Cognito-protected routes so external clients
 * can open it via a signed link in their email without needing to log in.
 * It uses the AppSync API key (set automatically by the Amplify config for
 * the `getClientPortal` query whose authorization is `allow.publicApiKey()`).
 *
 * Security invariants:
 *   - No pricing data ever rendered
 *   - No cross-client data exposure
 *   - No internal notes or audit info
 *   - Expired tokens show a polite refusal and ask the client to contact us
 */

interface PortalResponse {
  projectName?: string;
  companyName?: string;
  clientName?: string;
  siteCity?: string;
  siteState?: string;
  startDate?: string;
  expectedEndDate?: string;
  status?: string;
  unitCount?: number;
  units?: Array<{
    serialNumber: string;
    productName: string;
    modelNumber?: string;
    status: string;
    dispatchedAt?: string;
  }>;
  tokenExpiresAt?: string;
  generatedAt?: string;
  error?: string;
}

export function ClientPortalPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t") ?? "";
  const [data, setData] = useState<PortalResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !token) {
      setData({ error: "This link is incomplete. Please use the link sent in your email." });
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        // Public API — uses the AppSync apiKey configured on the client.
        const res = await (api as unknown as {
          queries: {
            getClientPortal: (
              args: { token: string; projectId: string },
              opts: { authMode: string },
            ) => Promise<{ data?: PortalResponse; errors?: Array<{ message?: string }> }>;
          };
        }).queries.getClientPortal(
          { token, projectId },
          { authMode: "apiKey" },
        );
        if (cancelled) return;
        if (res.errors?.length) {
          setData({ error: res.errors[0]?.message ?? "Couldn't load the portal." });
        } else {
          setData(res.data ?? { error: "Empty response." });
        }
      } catch (e) {
        if (!cancelled) setData({ error: (e as Error).message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, token]);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Minimal branded header (no sidebar, no chatbot). */}
      <header className="border-b bg-background">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2">
            {env.companyLogoUrl ? (
              <img src={env.companyLogoUrl} alt="" className="h-6 w-6" />
            ) : (
              <Building2 className="h-5 w-5 text-primary" />
            )}
            <span className="font-semibold text-sm">{data?.companyName ?? env.companyName}</span>
          </div>
          <span className="text-xs text-muted-foreground">Project delivery portal</span>
        </div>
      </header>

      <main className="container py-8 max-w-4xl">
        {loading && <LoadingView />}
        {!loading && data?.error && <ErrorView error={data.error} />}
        {!loading && !data?.error && data && <PortalContent data={data} />}
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <p>
          This is a view-only secure link. Please do not forward it —{" "}
          anyone with this URL can see the project status.
        </p>
        {data?.tokenExpiresAt && (
          <p className="mt-1">
            Link expires {formatIST(new Date(data.tokenExpiresAt))}.
          </p>
        )}
      </footer>
    </div>
  );
}

function LoadingView() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function ErrorView({ error }: { error: string }) {
  return (
    <Card className="p-8 text-center space-y-3 max-w-md mx-auto">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h1 className="text-lg font-semibold">Can't open this portal</h1>
      <p className="text-sm text-muted-foreground">{error}</p>
      <p className="text-xs text-muted-foreground pt-2">
        If this looks wrong, please reply to the email that sent you this link.
      </p>
    </Card>
  );
}

function PortalContent({ data }: { data: PortalResponse }) {
  const units = data.units ?? [];
  const returnedCount = units.filter((u) => u.status === "RETURNED").length;
  const liveCount = units.filter((u) => u.status !== "RETURNED").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{data.projectName}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4" />
          <span>{data.clientName}</span>
          {data.siteCity && (
            <>
              <MapPin className="h-4 w-4 ml-2" />
              <span>
                {data.siteCity}
                {data.siteState ? `, ${data.siteState}` : ""}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Key stats */}
      <div className="grid gap-3 md:grid-cols-4">
        <Stat icon={Package} label="Total units" value={String(data.unitCount ?? 0)} />
        <Stat icon={CheckCircle2} label="On site" value={String(liveCount)} tone="success" />
        <Stat icon={Boxes} label="Returned" value={String(returnedCount)} />
        <Stat
          icon={Calendar}
          label="Expected end"
          value={data.expectedEndDate ? formatIST(new Date(data.expectedEndDate)) : "—"}
        />
      </div>

      {data.status && (
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Project status:</span>
          <Badge
            variant={
              data.status === "COMPLETED"
                ? "success"
                : data.status === "IN_PROGRESS"
                  ? "default"
                  : "secondary"
            }
          >
            {data.status.replace(/_/g, " ")}
          </Badge>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 p-3">
          <div className="text-sm font-medium">Equipment allocated to this project</div>
          <div className="text-xs text-muted-foreground">
            Serial numbers are shown for your reference. No pricing is exposed on this page.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="p-3 text-left">Equipment</th>
                <th className="p-3 text-left">Serial #</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Dispatched</th>
              </tr>
            </thead>
            <tbody>
              {units.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                    No equipment has been allocated yet.
                  </td>
                </tr>
              ) : (
                units.map((u, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="p-3">
                      <div className="font-medium">{u.productName}</div>
                      {u.modelNumber && (
                        <div className="text-[10px] text-muted-foreground">{u.modelNumber}</div>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs">{u.serialNumber}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-[10px]">
                        {u.status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs">
                      {u.dispatchedAt ? formatIST(new Date(u.dispatchedAt)) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[11px] text-muted-foreground text-center">
        Last refreshed {data.generatedAt ? formatIST(new Date(data.generatedAt)) : "—"}.
      </p>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "success";
}) {
  return (
    <Card
      className={cn(
        "p-3 flex items-center justify-between",
        tone === "success" && "border-success/40 bg-success/5",
      )}
    >
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-xl font-semibold font-mono">{value}</div>
      </div>
      <Icon className="h-5 w-5 text-muted-foreground" />
    </Card>
  );
}
