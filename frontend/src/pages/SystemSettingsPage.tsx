import * as React from "react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, FileText, Loader2, Save, Settings, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GstinInput } from "@/components/fields/gstin-input";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/amplify-client";
import { MSME_CLASSIFICATIONS } from "@shared/constants";
import { GSTIN_REGEX } from "@shared/gstin";

/**
 * System Settings — the first place a new Admin visits after deploy.
 *
 * SystemSettings is a single-row table keyed on id = "GLOBAL". If no row
 * exists (first deploy), we create one on Save with that id.
 */
const schema = z.object({
  // Company
  companyName: z.string().min(2, "Required"),
  companyGstin: z.string().regex(GSTIN_REGEX, "Invalid GSTIN").optional().or(z.literal("")),
  companyAddressLine1: z.string().optional(),
  companyCity: z.string().optional(),
  companyState: z.string().optional(),
  companyPincode: z.string().optional(),
  companyOpsEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyLogoS3Key: z.string().optional(),

  // Numbering
  invoicePrefix: z.string().max(6).default("INV"),
  dcPrefix: z.string().max(6).default("DC"),
  grnPrefix: z.string().max(6).default("GRN"),
  poPrefix: z.string().max(6).default("PO"),

  // Thresholds
  eWayBillThresholdInr: z.coerce.number().min(0).default(50000),
  poApprovalThresholdInr: z.coerce.number().min(0).default(50000),
  cognitoIdleSessionTtlSeconds: z.coerce.number().int().min(900).max(7200).default(1800),
  chatbotRateLimitPerMin: z.coerce.number().int().min(1).max(60).default(10),

  // MSME
  msmeEnabled: z.boolean().default(true),
  msmeUdyamRegistrationNumber: z.string().optional(),
  msmeCertificateS3Key: z.string().optional(),
  msmeEnterpriseClassification: z.enum(MSME_CLASSIFICATIONS).optional(),
  msmeRequireAdminApproval: z.boolean().default(false),
  msmeAutoTriggerDays: z.coerce.number().int().min(1).max(90).default(45),

  // Tally
  tallyPurchaseLedgerName: z.string().optional(),
  tallySalesLedgerName: z.string().optional(),
  tallyCgstLedgerName: z.string().optional(),
  tallySgstLedgerName: z.string().optional(),
  tallyIgstLedgerName: z.string().optional(),

  // SES
  sesFromEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  sesReplyTo: z.string().email("Invalid email").optional().or(z.literal("")),
  sesConfigurationSet: z.string().optional(),

  // DC price source
  dcPriceSource: z.enum(["PURCHASE_PRICE", "SELLING_PRICE"]).default("SELLING_PRICE"),
});
type SettingsForm = z.infer<typeof schema>;

export function SystemSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);

  const form = useForm<SettingsForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      companyName: "",
      invoicePrefix: "INV",
      dcPrefix: "DC",
      grnPrefix: "GRN",
      poPrefix: "PO",
      eWayBillThresholdInr: 50000,
      poApprovalThresholdInr: 50000,
      cognitoIdleSessionTtlSeconds: 1800,
      chatbotRateLimitPerMin: 10,
      msmeEnabled: true,
      msmeAutoTriggerDays: 45,
      msmeRequireAdminApproval: false,
      dcPriceSource: "SELLING_PRICE",
    },
  });

  // Load the (single) SystemSettings row.
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await (
          api.models as unknown as {
            SystemSettings: {
              list: (args: { limit: number }) => Promise<{ data?: Array<SettingsForm & { id: string }> }>;
            };
          }
        ).SystemSettings.list({ limit: 1 });
        const row = res.data?.[0];
        if (row) {
          setExistingId(row.id);
          form.reset(row);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    const ok = await form.trigger();
    if (!ok) {
      toast.error("Fix the highlighted errors");
      return;
    }
    setSaving(true);
    try {
      const payload = form.getValues();
      if (existingId) {
        await (
          api.models as unknown as {
            SystemSettings: {
              update: (input: Record<string, unknown>) => Promise<{ errors?: unknown }>;
            };
          }
        ).SystemSettings.update({
          id: existingId,
          ...payload,
          companyStateCode: payload.companyGstin?.slice(0, 2),
        });
      } else {
        const res = await (
          api.models as unknown as {
            SystemSettings: {
              create: (input: Record<string, unknown>) => Promise<{ data?: { id: string } }>;
            };
          }
        ).SystemSettings.create({
          ...payload,
          id: "GLOBAL",
          companyStateCode: payload.companyGstin?.slice(0, 2),
        });
        if (res.data?.id) setExistingId(res.data.id);
      }
      toast.success("Settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title="System Settings"
        description="First-time setup + ongoing configuration. Every Lambda and resolver reads from here."
        breadcrumbs={[{ label: "Admin" }, { label: "Settings" }]}
        actions={
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        }
      />

      <Tabs defaultValue="company">
        <TabsList className="w-full">
          <TabsTrigger value="company" className="flex-1">
            <Building2 className="h-3 w-3 mr-1" />
            Company
          </TabsTrigger>
          <TabsTrigger value="numbering" className="flex-1">
            <FileText className="h-3 w-3 mr-1" />
            Numbering + thresholds
          </TabsTrigger>
          <TabsTrigger value="msme" className="flex-1">
            <ShieldAlert className="h-3 w-3 mr-1" />
            MSME
          </TabsTrigger>
          <TabsTrigger value="tally" className="flex-1">
            Tally
          </TabsTrigger>
          <TabsTrigger value="ses" className="flex-1">
            <Settings className="h-3 w-3 mr-1" />
            Email + security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="space-y-4 pt-4">
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">Company identity</div>
            <Labeled label="Legal name *">
              <Input {...form.register("companyName")} />
              {form.formState.errors.companyName && (
                <p className="text-[11px] text-destructive">{form.formState.errors.companyName.message}</p>
              )}
            </Labeled>
            <GstinInput
              label="Company GSTIN"
              value={form.watch("companyGstin") ?? ""}
              onChange={(v) => form.setValue("companyGstin", v, { shouldValidate: true })}
              error={form.formState.errors.companyGstin?.message}
            />
            <Labeled label="Operations email (Reply-To)">
              <Input type="email" {...form.register("companyOpsEmail")} />
            </Labeled>
          </Card>
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">Address</div>
            <Labeled label="Address"><Input {...form.register("companyAddressLine1")} /></Labeled>
            <div className="grid grid-cols-3 gap-3">
              <Labeled label="City"><Input {...form.register("companyCity")} /></Labeled>
              <Labeled label="State"><Input {...form.register("companyState")} /></Labeled>
              <Labeled label="Pincode"><Input {...form.register("companyPincode")} maxLength={6} /></Labeled>
            </div>
          </Card>
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">Logo</div>
            <Labeled label="S3 key for logo (PNG / SVG)">
              <Input {...form.register("companyLogoS3Key")} placeholder="logo/company-logo.png" />
              <p className="text-[11px] text-muted-foreground">
                Upload the logo to the public email-assets S3 bucket; enter the S3 key here. It'll be embedded in every outbound SES email.
              </p>
            </Labeled>
          </Card>
        </TabsContent>

        <TabsContent value="numbering" className="space-y-4 pt-4">
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">GST-compliant document number prefixes</div>
            <p className="text-[11px] text-muted-foreground">
              Format: <code>[PREFIX]-[FY]-[SEQ]</code>. Sequence resets to 00001 on April 1 every year. Max 16 chars total — keep prefixes short.
            </p>
            <div className="grid grid-cols-4 gap-3">
              <Labeled label="Invoice prefix">
                <Input {...form.register("invoicePrefix")} maxLength={6} className="font-mono uppercase" />
              </Labeled>
              <Labeled label="DC prefix">
                <Input {...form.register("dcPrefix")} maxLength={6} className="font-mono uppercase" />
              </Labeled>
              <Labeled label="GRN prefix">
                <Input {...form.register("grnPrefix")} maxLength={6} className="font-mono uppercase" />
              </Labeled>
              <Labeled label="PO prefix">
                <Input {...form.register("poPrefix")} maxLength={6} className="font-mono uppercase" />
              </Labeled>
            </div>
          </Card>
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">Thresholds</div>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="e-Way Bill threshold (INR)">
                <Input type="number" min={0} {...form.register("eWayBillThresholdInr")} />
                <p className="text-[11px] text-muted-foreground">
                  e-Way Bill becomes mandatory on DCs ≥ this amount. Default ₹ 50,000 per GST rules.
                </p>
              </Labeled>
              <Labeled label="PO approval threshold (INR)">
                <Input type="number" min={0} {...form.register("poApprovalThresholdInr")} />
                <p className="text-[11px] text-muted-foreground">
                  POs at or above this amount require Admin approval.
                </p>
              </Labeled>
              <Labeled label="Session idle timeout (seconds)">
                <Input type="number" min={900} max={7200} {...form.register("cognitoIdleSessionTtlSeconds")} />
                <p className="text-[11px] text-muted-foreground">900–7200s (15 min – 2 hr).</p>
              </Labeled>
              <Labeled label="Chatbot rate limit (per min)">
                <Input type="number" min={1} max={60} {...form.register("chatbotRateLimitPerMin")} />
              </Labeled>
            </div>
          </Card>
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">DC pricing source</div>
            <Labeled label="Use which price for DC value totals?">
              <Select
                value={form.watch("dcPriceSource")}
                onValueChange={(v) => form.setValue("dcPriceSource", v as SettingsForm["dcPriceSource"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SELLING_PRICE">Selling price (default — customer-facing total)</SelectItem>
                  <SelectItem value="PURCHASE_PRICE">Purchase price (cost basis)</SelectItem>
                </SelectContent>
              </Select>
            </Labeled>
          </Card>
        </TabsContent>

        <TabsContent value="msme" className="space-y-4 pt-4">
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">MSMED Act 2006 compliance</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox {...form.register("msmeEnabled")} />
              <span className="text-sm">Enable MSME compliance flow</span>
            </label>
            {form.watch("msmeEnabled") && (
              <>
                <Labeled label="Udyam Registration Number *">
                  <Input {...form.register("msmeUdyamRegistrationNumber")} placeholder="UDYAM-MH-25-1234567" />
                </Labeled>
                <Labeled label="MSME certificate S3 key *">
                  <Input {...form.register("msmeCertificateS3Key")} placeholder="msme/certificate.pdf" />
                  <p className="text-[11px] text-muted-foreground">
                    Upload your Udyam certificate PDF to the private S3 bucket. This file is attached to every MSME notice email.
                  </p>
                </Labeled>
                <div className="grid grid-cols-2 gap-3">
                  <Labeled label="Enterprise classification">
                    <Select
                      value={form.watch("msmeEnterpriseClassification") ?? ""}
                      onValueChange={(v) => form.setValue("msmeEnterpriseClassification", v as SettingsForm["msmeEnterpriseClassification"])}
                    >
                      <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
                      <SelectContent>
                        {MSME_CLASSIFICATIONS.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Labeled>
                  <Labeled label="Auto-trigger days (default 45)">
                    <Input type="number" min={1} max={90} {...form.register("msmeAutoTriggerDays")} />
                  </Labeled>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox {...form.register("msmeRequireAdminApproval")} />
                  <span className="text-sm">Require Admin approval before sending MSME notice</span>
                </label>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="tally" className="space-y-4 pt-4">
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">Tally ledger mapping</div>
            <p className="text-[11px] text-muted-foreground">
              These ledger names must match your Tally company exactly (byte-for-byte). See{" "}
              <code>docs/deployment/05-tally-ledger-mapping.md</code>.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Purchase Ledger">
                <Input {...form.register("tallyPurchaseLedgerName")} placeholder="Purchase Accounts" />
              </Labeled>
              <Labeled label="Sales Ledger">
                <Input {...form.register("tallySalesLedgerName")} placeholder="Sales Accounts" />
              </Labeled>
              <Labeled label="CGST Ledger">
                <Input {...form.register("tallyCgstLedgerName")} placeholder="CGST 9%" />
              </Labeled>
              <Labeled label="SGST Ledger">
                <Input {...form.register("tallySgstLedgerName")} placeholder="SGST 9%" />
              </Labeled>
              <Labeled label="IGST Ledger">
                <Input {...form.register("tallyIgstLedgerName")} placeholder="IGST 18%" />
              </Labeled>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Vendor- and client-specific Tally names are set on each individual vendor/client record.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="ses" className="space-y-4 pt-4">
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">SES email identity</div>
            <Labeled label="From email">
              <Input type="email" {...form.register("sesFromEmail")} placeholder="no-reply@inventory.yourco.in" />
              <p className="text-[11px] text-muted-foreground">
                Must be a verified SES identity in your AWS region.
              </p>
            </Labeled>
            <Labeled label="Reply-To">
              <Input type="email" {...form.register("sesReplyTo")} placeholder="ops@yourco.in" />
            </Labeled>
            <Labeled label="Configuration set">
              <Input {...form.register("sesConfigurationSet")} placeholder="av-inventory-prod" />
            </Labeled>
          </Card>
        </TabsContent>
      </Tabs>
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
