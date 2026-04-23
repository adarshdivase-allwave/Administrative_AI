import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Search, Sparkles, CheckCircle2, AlertCircle, Copy, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/amplify-client";
import { validateHsn } from "@shared/hsn";
import { cn } from "@/lib/cn";

/**
 * HSN Lookup Tool — calls the `validateHsn` Lambda-backed AppSync mutation.
 *
 * Flow:
 *   1. Client-side instant validation via shared/hsn.ts (format, SAC detection)
 *   2. On submit, Lambda does OpenSearch lookup → Gemini AI fallback
 *   3. Result card shows the full match with a "Source: cbic.gov.in" chip
 *      when grounded by Google Search
 *
 * Admin + Purchase + Logistics can use this.
 */
const schema = z
  .object({
    hsnCode: z.string().optional(),
    productName: z.string().optional(),
    productSpecs: z.string().optional(),
  })
  .refine((d) => Boolean(d.hsnCode || d.productName), {
    path: ["hsnCode"],
    message: "Enter either an HSN code or a product name",
  });

interface LookupResult {
  status: "VALID" | "INVALID" | "AI_SUGGESTED";
  hsnCode: string;
  description: string;
  gstRatePercent: number;
  tallyFormat: string;
  tallyCompatible: boolean;
  isSac: boolean;
  sourceUrl?: string;
  sourceDomain?: string;
  error?: string;
}

export function HsnLookupPage() {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { hsnCode: "", productName: "", productSpecs: "" },
  });

  const watchedCode = form.watch("hsnCode");
  const clientValidation = watchedCode ? validateHsn(watchedCode) : null;

  async function onSubmit(values: z.infer<typeof schema>) {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await (
        api as unknown as {
          mutations: {
            validateHsn: (args: z.infer<typeof schema>) => Promise<{ data?: LookupResult }>;
          };
        }
      ).mutations.validateHsn({
        hsnCode: values.hsnCode || undefined,
        productName: values.productName || undefined,
        productSpecs: values.productSpecs || undefined,
      });
      if (res.data) setResult(res.data);
      else toast.error("Empty response from HSN validator");
    } catch (e) {
      toast.error((e as Error).message ?? "HSN lookup failed");
    } finally {
      setSubmitting(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    toast.success(`Copied "${text}"`);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">HSN / SAC Lookup</h1>
        <p className="text-sm text-muted-foreground">
          Search India&apos;s GST Tariff Schedule by code or by product description. Falls back
          to AI-assisted grounded search with official CBIC citations.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="hsnCode">HSN or SAC code</Label>
                <Input
                  id="hsnCode"
                  placeholder="e.g. 85287200 or 998314"
                  inputMode="numeric"
                  {...form.register("hsnCode")}
                />
                {watchedCode && clientValidation && (
                  <p
                    className={cn(
                      "text-[11px]",
                      clientValidation.valid ? "text-success" : "text-destructive",
                    )}
                  >
                    {clientValidation.valid
                      ? `Format OK — ${clientValidation.length}-digit ${clientValidation.isSac ? "SAC" : "HSN"}`
                      : clientValidation.error}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="productName">Product name</Label>
                <Input
                  id="productName"
                  placeholder="e.g. 55-inch LCD signage display"
                  {...form.register("productName")}
                />
                <p className="text-[11px] text-muted-foreground">
                  Used when the code is unknown — triggers AI lookup.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="productSpecs">Extra specifications (optional)</Label>
              <Input
                id="productSpecs"
                placeholder="Model LG 55UR640S, 4K, commercial signage"
                {...form.register("productSpecs")}
              />
            </div>

            {form.formState.errors.hsnCode && (
              <p className="text-xs text-destructive">{form.formState.errors.hsnCode.message}</p>
            )}

            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search />}
              {submitting ? "Searching…" : "Search"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card
          className={cn(
            result.status === "VALID" && "border-success/40",
            result.status === "AI_SUGGESTED" && "border-primary/40",
            result.status === "INVALID" && "border-destructive/40",
          )}
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {result.status === "VALID" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : result.status === "AI_SUGGESTED" ? (
                    <Sparkles className="h-5 w-5 text-primary" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  )}
                  {result.hsnCode || "No code"}
                </CardTitle>
                <CardDescription>{result.description || result.error}</CardDescription>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant={result.tallyCompatible ? "success" : "destructive"}>
                  {result.tallyCompatible ? "Tally-compatible" : "Tally incompatible"}
                </Badge>
                {result.isSac && <Badge variant="secondary">SAC</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KeyVal label="GST rate" value={`${result.gstRatePercent}%`} />
              <KeyVal
                label="CGST"
                value={`${(result.gstRatePercent / 2).toFixed(1)}%`}
                subtle
              />
              <KeyVal
                label="SGST"
                value={`${(result.gstRatePercent / 2).toFixed(1)}%`}
                subtle
              />
              <KeyVal label="IGST" value={`${result.gstRatePercent}%`} subtle />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => copy(result.hsnCode)}>
                <Copy className="h-4 w-4" /> Copy code
              </Button>
              <Button variant="outline" size="sm" onClick={() => copy(result.tallyFormat)}>
                <Copy className="h-4 w-4" /> Copy Tally format
              </Button>
              {result.sourceUrl && (
                <a
                  href={result.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  Source: {result.sourceDomain ?? new URL(result.sourceUrl).hostname}
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KeyVal({ label, value, subtle }: { label: string; value: string; subtle?: boolean }) {
  return (
    <div className={cn("rounded-md border p-2", subtle && "bg-muted/40")}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm">{value}</div>
    </div>
  );
}
