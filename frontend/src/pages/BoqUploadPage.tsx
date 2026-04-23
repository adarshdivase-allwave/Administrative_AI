import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileUp, Loader2, Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/amplify-client";
import { uploadData } from "aws-amplify/storage";
import { formatInr } from "@shared/currency";

/**
 * BOQ Upload — drives the `boq-parser` Lambda.
 *
 * Flow:
 *   1. User drops / picks a .xlsx or .csv
 *   2. We upload it to `boq-uploads/{uuid}-{filename}` via Amplify Storage
 *   3. Call `parseBoq` mutation → the Lambda fuzzy-matches each line against
 *      ProductMaster and validates HSN codes
 *   4. Render the result: matched (green) / unmatched (yellow) / HSN warnings (red)
 *   5. "Convert to PO" creates a draft PO with the matched line items
 */

interface ParseResult {
  totalLines: number;
  matched: number;
  unmatched: number;
  hsnWarnings: number;
  lineItems: Array<{
    sourceRow: number;
    description: string;
    quantity: number;
    unitRate?: number;
    lineTotal?: number;
    hsn?: string;
    hsnValid?: boolean;
    matchedProductId?: string;
    matchedProductName?: string;
    matchConfidence?: number;
    warnings: string[];
  }>;
}

export function BoqUploadPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    // Guardrails: file type + 10 MB limit per spec §25.
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      toast.error("Only .xlsx and .csv files are supported");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10 MB");
      return;
    }

    setUploading(true);
    setFileName(file.name);
    setResult(null);

    try {
      const key = `boq-uploads/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      await uploadData({ path: key, data: file }).result;
      setUploading(false);
      setParsing(true);

      // We need the bucket name to pass to the Lambda. Amplify outputs it
      // on the client config; in practice the Lambda reads `PRIVATE_BUCKET_NAME`
      // from its environment, so the client just sends the S3 key.
      // Here we pass a placeholder bucket — the Lambda's env var wins.
      const res = await (
        api as unknown as {
          mutations: {
            parseBoq: (args: { s3Bucket: string; s3Key: string }) => Promise<{ data?: ParseResult }>;
          };
        }
      ).mutations.parseBoq({
        s3Bucket: "__from_lambda_env__",
        s3Key: key,
      });

      if (res.data) {
        setResult(res.data);
        toast.success(`Parsed ${res.data.totalLines} line${res.data.totalLines !== 1 ? "s" : ""}`);
      } else {
        toast.error("BOQ parser returned an empty response");
      }
    } catch (e) {
      toast.error((e as Error).message ?? "Upload or parse failed");
    } finally {
      setUploading(false);
      setParsing(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title="BOQ upload"
        description="Upload a vendor's Bill of Quantity sheet (.xlsx or .csv). We'll fuzzy-match each line to your ProductMaster and validate HSN codes."
        breadcrumbs={[{ label: "Procurement" }, { label: "BOQ" }]}
      />

      <Card
        className="p-10 border-dashed border-2 text-center space-y-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Drop your BOQ here</p>
          <p className="text-xs text-muted-foreground">.xlsx or .csv, up to 10 MB</p>
        </div>
        <div>
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || parsing}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : uploading ? <Upload className="h-4 w-4" /> : <FileUp className="h-4 w-4" />}
            {uploading ? "Uploading…" : parsing ? "Parsing…" : "Pick a file"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>
        {fileName && <p className="text-xs text-muted-foreground">File: {fileName}</p>}
      </Card>

      {result && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <SummaryTile icon={FileSpreadsheet} label="Total lines" value={result.totalLines} />
            <SummaryTile icon={CheckCircle2} label="Matched" value={result.matched} tone="success" />
            <SummaryTile
              icon={AlertTriangle}
              label="Unmatched"
              value={result.unmatched}
              tone={result.unmatched > 0 ? "warning" : undefined}
            />
            <SummaryTile
              icon={AlertTriangle}
              label="HSN warnings"
              value={result.hsnWarnings}
              tone={result.hsnWarnings > 0 ? "destructive" : undefined}
            />
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="h-10 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">#</th>
                    <th className="h-10 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</th>
                    <th className="h-10 px-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Qty</th>
                    <th className="h-10 px-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Rate</th>
                    <th className="h-10 px-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Total</th>
                    <th className="h-10 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">HSN</th>
                    <th className="h-10 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lineItems.map((li, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 font-mono text-[11px] text-muted-foreground">{li.sourceRow}</td>
                      <td className="p-2 text-xs max-w-xs truncate" title={li.description}>{li.description}</td>
                      <td className="p-2 text-right font-mono text-xs">{li.quantity}</td>
                      <td className="p-2 text-right font-mono text-xs">
                        {li.unitRate ? formatInr(li.unitRate, { showSymbol: false }) : "—"}
                      </td>
                      <td className="p-2 text-right font-mono text-xs">
                        {li.lineTotal ? formatInr(li.lineTotal, { showSymbol: false }) : "—"}
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {li.hsn ? (
                          <Badge variant={li.hsnValid ? "success" : "destructive"} className="text-[10px]">
                            {li.hsn}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {li.matchedProductId ? (
                          <div>
                            <div className="text-[11px]">{li.matchedProductName}</div>
                            <Badge variant="success" className="text-[10px]">
                              {Math.round((li.matchConfidence ?? 0) * 100)}%
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="warning" className="text-[10px]">Unmatched</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-end">
            <Button disabled>
              Convert to PO (coming next iteration)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "success" | "warning" | "destructive";
}) {
  const bg =
    tone === "success" ? "border-success/40 bg-success/5" :
    tone === "warning" ? "border-warning/40 bg-warning/5" :
    tone === "destructive" ? "border-destructive/40 bg-destructive/5" : "";
  return (
    <Card className={`${bg} p-3 flex items-center justify-between`}>
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
      <Icon className="h-5 w-5 text-muted-foreground" />
    </Card>
  );
}
