import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCrud } from "@/hooks/use-crud";
import { formatInr } from "@shared/currency";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@shared/constants";
import { fyLabel, fyStartYear, daysBetween } from "@shared/fy";

interface Unit {
  id: string;
  productId?: string;
  inventoryCategory?: InventoryCategory;
  status?: string;
  purchasePrice?: number;
  currentBookValue?: number;
  vendorId?: string;
  grnId?: string;
}
interface Product { id: string; productName?: string }

const CATEGORY_COLORS: Record<InventoryCategory, string> = {
  GENERAL_STOCK: "#22c55e",
  PROJECT: "#3b82f6",
  DEMO: "#f59e0b",
  STANDBY: "#8b5cf6",
  ASSET: "#ef4444",
};

export function ReportsPage() {
  const units = useCrud<Unit>("UnitRecord", { limit: 2000 });
  const products = useCrud<Product>("ProductMaster", { limit: 500 });
  const fy = fyLabel(new Date());

  const productById = useMemo(
    () => new Map(products.data.map((p) => [p.id, p])),
    [products.data],
  );

  // Inventory value by category.
  const valueByCategory = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const u of units.data) {
      const cat = u.inventoryCategory ?? "GENERAL_STOCK";
      acc[cat] = (acc[cat] ?? 0) + (u.purchasePrice ?? 0);
    }
    return (Object.entries(acc)
      .map(([category, value]) => ({ category, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)) as Array<{ category: InventoryCategory; value: number }>;
  }, [units.data]);

  const totalCost = valueByCategory.reduce((s, r) => s + r.value, 0);

  // Depreciation summary — ASSET units only.
  const assetDepreciation = useMemo(() => {
    const assets = units.data.filter((u) => u.inventoryCategory === "ASSET");
    return {
      count: assets.length,
      cost: assets.reduce((s, a) => s + (a.purchasePrice ?? 0), 0),
      bookValue: assets.reduce((s, a) => s + (a.currentBookValue ?? a.purchasePrice ?? 0), 0),
    };
  }, [units.data]);

  // Top 10 dispatched products (proxy: count units allocated/on-demo).
  const topDispatched = useMemo(() => {
    const byProduct: Record<string, { count: number }> = {};
    for (const u of units.data) {
      if (
        u.inventoryCategory === "PROJECT" ||
        u.inventoryCategory === "DEMO" ||
        u.status === "DISPATCHED"
      ) {
        const pid = u.productId ?? "__unknown";
        byProduct[pid] = byProduct[pid] ?? { count: 0 };
        byProduct[pid].count += 1;
      }
    }
    return Object.entries(byProduct)
      .map(([productId, v]) => ({
        name: productById.get(productId)?.productName?.slice(0, 30) ?? "(unknown)",
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [units.data, productById]);

  function exportCsv() {
    const rows: Array<Array<string | number>> = [
      ["Category", "Units", "Total cost (INR)"],
      ...valueByCategory.map((v) => [
        v.category,
        units.data.filter((u) => u.inventoryCategory === v.category).length,
        v.value,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `inventory-report-${fyStartYear(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description={`${fy} · ${units.data.length} total units · ${products.data.length} products`}
        breadcrumbs={[{ label: "Admin" }, { label: "Reports" }]}
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={units.loading}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Total inventory value" value={formatInr(totalCost)} />
        <SummaryCard label="Asset book value" value={formatInr(assetDepreciation.bookValue)} />
        <SummaryCard
          label="Depreciation (so far)"
          value={formatInr(assetDepreciation.cost - assetDepreciation.bookValue)}
          tone="warning"
        />
        <SummaryCard label="Assets tracked" value={String(assetDepreciation.count)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Inventory value by category</div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={valueByCategory}
                  dataKey="value"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(entry) => {
                    const d = entry as { category: InventoryCategory; value: number };
                    return `${d.category.replace(/_/g, " ")} · ${formatInr(d.value, { showSymbol: false })}`;
                  }}
                >
                  {valueByCategory.map((v, i) => (
                    <Cell key={i} fill={CATEGORY_COLORS[v.category as InventoryCategory] ?? "#888"} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatInr(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[11px] text-muted-foreground pt-2">
            Cost basis, excluding GST. Source: sum of UnitRecord.purchasePrice.
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" /> Top dispatched (this FY)
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topDispatched} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" className="text-xs" />
                <YAxis type="category" dataKey="name" width={140} className="text-xs" />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" name="Units" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-2 text-sm font-medium">Category breakdown</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="py-2 text-left">Category</th>
                <th className="py-2 text-right">Units</th>
                <th className="py-2 text-right">Total cost</th>
                <th className="py-2 text-right">% of total</th>
              </tr>
            </thead>
            <tbody>
              {INVENTORY_CATEGORIES.map((cat) => {
                const cUnits = units.data.filter((u) => u.inventoryCategory === cat);
                const cValue = cUnits.reduce((s, u) => s + (u.purchasePrice ?? 0), 0);
                const pct = totalCost > 0 ? (cValue / totalCost) * 100 : 0;
                return (
                  <tr key={cat} className="border-b last:border-b-0">
                    <td className="py-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full mr-2"
                        style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                      />
                      {cat.replace(/_/g, " ")}
                    </td>
                    <td className="py-2 text-right font-mono">{cUnits.length}</td>
                    <td className="py-2 text-right font-mono">{formatInr(cValue)}</td>
                    <td className="py-2 text-right font-mono text-muted-foreground">
                      {pct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 text-xs text-muted-foreground">
        Data refreshed {formatRefresh(units.loading)}. Deeper FY-over-FY comparisons, vendor
        performance, and monthly depreciation trend arrive with the analytics Lambda materialized
        views (Phase 11 — deferred).
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <Card className={`p-3 ${tone === "warning" ? "border-warning/40 bg-warning/5" : ""}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold font-mono">{value}</div>
    </Card>
  );
}

function formatRefresh(loading: boolean): string {
  if (loading) return "loading...";
  return `just now (${daysBetween(new Date(), new Date()) === 0 ? "today" : ""})`;
}
