import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calculator, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { formatInr, toInr } from "@shared/currency";
import { api } from "@/lib/amplify-client";

/**
 * Import Cost Estimator — end-to-end India import landed-cost calculation.
 *
 *   FOB (foreign) × forex = FOB (INR)
 *   CIF = FOB + Freight + Insurance
 *   Customs Duty = CIF × customsDutyPercent
 *   Social Welfare Surcharge = Customs × 10%
 *   Assessable Value = CIF + Customs + SWS
 *   IGST = Assessable × igstPercent
 *   Total landed = CIF + Customs + SWS + IGST + Landing charges
 *
 * Live forex rate is fetched from the `forex-rate-fetcher` Lambda (6-hour
 * cached). Users can force a refresh; cache-hit vs. live is clearly labeled.
 */
const schema = z.object({
  productName: z.string().min(1, "Required"),
  quantity: z.coerce.number().int().positive("Must be > 0"),
  fobPricePerUnit: z.coerce.number().positive("Must be > 0"),
  currency: z.enum(["USD", "EUR", "GBP"]),
  freightInr: z.coerce.number().nonnegative().default(0),
  insurancePercent: z.coerce.number().min(0).max(20).default(1.125),
  customsDutyPercent: z.coerce.number().min(0).max(100).default(10),
  igstPercent: z.coerce.number().min(0).max(28).default(18),
  landingChargesInr: z.coerce.number().nonnegative().default(0),
});
type FormValues = z.infer<typeof schema>;

interface ForexResult {
  rate: number;
  fetchedAt: string;
  cacheHit: boolean;
  source: string;
}

export function ImportEstimatorPage() {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      productName: "",
      quantity: 1,
      fobPricePerUnit: 0,
      currency: "USD",
      freightInr: 0,
      insurancePercent: 1.125,
      customsDutyPercent: 10,
      igstPercent: 18,
      landingChargesInr: 0,
    },
  });

  const values = useWatch({ control: form.control });
  const [forex, setForex] = useState<ForexResult | null>(null);
  const [fetchingForex, setFetchingForex] = useState(false);

  // Fetch rate on currency change.
  useEffect(() => {
    if (!values.currency) return;
    void fetchForex(values.currency, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.currency]);

  async function fetchForex(quote: "USD" | "EUR" | "GBP", force: boolean) {
    setFetchingForex(true);
    try {
      const res = await (
        api as unknown as {
          mutations: {
            forexRate: (args: {
              quoteCurrency: string;
              forceRefresh?: boolean;
            }) => Promise<{ data?: ForexResult }>;
          };
        }
      ).mutations.forexRate({ quoteCurrency: quote, forceRefresh: force });
      if (res.data) setForex(res.data);
    } catch (e) {
      toast.error((e as Error).message ?? "Forex lookup failed");
    } finally {
      setFetchingForex(false);
    }
  }

  const calc = useMemo(() => compute(values, forex?.rate ?? null), [values, forex?.rate]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import cost estimator</h1>
        <p className="text-sm text-muted-foreground">
          FOB → CIF → Customs → SWS → Assessable → IGST → Landed cost, with live forex.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4" /> Inputs
            </CardTitle>
            <CardDescription>
              All INR amounts update live as you type. Forex rate is cached for 6 hours.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <FormRow label="Product name">
              <Input {...form.register("productName")} placeholder="e.g. Poly Studio X70" />
            </FormRow>
            <FormRow label="Quantity">
              <Input type="number" inputMode="numeric" {...form.register("quantity")} />
            </FormRow>

            <FormRow label="FOB price per unit">
              <Input type="number" step="0.01" {...form.register("fobPricePerUnit")} />
            </FormRow>
            <FormRow label="Currency">
              <Select
                value={values.currency}
                onValueChange={(v) => form.setValue("currency", v as FormValues["currency"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD — US dollar</SelectItem>
                  <SelectItem value="EUR">EUR — Euro</SelectItem>
                  <SelectItem value="GBP">GBP — British pound</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>

            <FormRow label="Freight (INR)">
              <Input type="number" step="0.01" {...form.register("freightInr")} />
            </FormRow>
            <FormRow label="Insurance % of FOB (default 1.125%)">
              <Input type="number" step="0.001" {...form.register("insurancePercent")} />
            </FormRow>

            <FormRow label="Customs Duty %">
              <Input type="number" step="0.01" {...form.register("customsDutyPercent")} />
            </FormRow>
            <FormRow label="IGST %">
              <Input type="number" step="0.01" {...form.register("igstPercent")} />
            </FormRow>

            <FormRow label="Landing / CHA charges (INR)">
              <Input type="number" step="0.01" {...form.register("landingChargesInr")} />
            </FormRow>

            <div className="flex items-end">
              <div className="rounded-md border bg-muted/40 p-3 w-full">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Live forex rate
                </div>
                <div className="mt-0.5 flex items-center justify-between">
                  <div className="font-mono text-sm">
                    {forex
                      ? `1 ${values.currency} = ₹ ${forex.rate.toFixed(2)}`
                      : fetchingForex
                        ? "Fetching…"
                        : "—"}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => fetchForex(values.currency ?? "USD", true)}
                    disabled={fetchingForex}
                    aria-label="Refresh forex rate"
                  >
                    {fetchingForex ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                  </Button>
                </div>
                {forex && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {forex.cacheHit ? "Cached" : "Live"} · {new Date(forex.fetchedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Landed cost</CardTitle>
            <CardDescription>Per-unit and total in INR</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-sm">
            <Row label="FOB value" value={calc.fobInr} />
            <Row label="+ Freight" value={calc.freight} />
            <Row label="+ Insurance" value={calc.insurance} />
            <Separator />
            <Row label="CIF value" value={calc.cif} bold />
            <Row label="+ Customs duty" value={calc.customs} />
            <Row label={`+ SWS (${(10).toFixed(0)}%)`} value={calc.sws} />
            <Separator />
            <Row label="Assessable value" value={calc.assessable} bold />
            <Row label="+ IGST" value={calc.igst} />
            <Row label="+ Landing charges" value={calc.landing} />
            <Separator />
            <Row label="Total landed cost" value={calc.totalLanded} bold highlight />
            <Row label="Per unit" value={calc.perUnit} muted />
            <div className="pt-2">
              <Badge variant={calc.markupPct > 100 ? "warning" : "secondary"} className="font-mono">
                Markup over FOB: {calc.markupPct.toFixed(1)}%
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  highlight,
  muted,
}: {
  label: string;
  value: number;
  bold?: boolean;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span
        className={`${bold ? "font-semibold" : ""} ${highlight ? "text-primary text-base" : ""}`}
      >
        {Number.isFinite(value) ? formatInr(value) : "—"}
      </span>
    </div>
  );
}

function compute(v: Partial<FormValues>, rate: number | null) {
  const qty = Number(v.quantity) || 0;
  const fob = Number(v.fobPricePerUnit) || 0;
  const freight = Number(v.freightInr) || 0;
  const insurancePct = Number(v.insurancePercent) || 0;
  const customsPct = Number(v.customsDutyPercent) || 0;
  const igstPct = Number(v.igstPercent) || 0;
  const landing = Number(v.landingChargesInr) || 0;

  const fobInr = rate ? toInr(fob * qty, rate) : 0;
  const insurance = +(fobInr * (insurancePct / 100)).toFixed(2);
  const cif = +(fobInr + freight + insurance).toFixed(2);
  const customs = +(cif * (customsPct / 100)).toFixed(2);
  const sws = +(customs * 0.1).toFixed(2); // Social Welfare Surcharge
  const assessable = +(cif + customs + sws).toFixed(2);
  const igst = +(assessable * (igstPct / 100)).toFixed(2);
  const totalLanded = +(cif + customs + sws + igst + landing).toFixed(2);
  const perUnit = qty > 0 ? +(totalLanded / qty).toFixed(2) : 0;
  const markupPct = fobInr > 0 ? ((totalLanded - fobInr) / fobInr) * 100 : 0;

  return { fobInr, freight, insurance, cif, customs, sws, assessable, igst, landing, totalLanded, perUnit, markupPct };
}
