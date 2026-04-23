import { Suspense, useEffect } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "@/components/ui/toast";
import { useAuthStore } from "@/stores/auth-store";

import { AppLayout } from "@/layout/AppLayout";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { SignInPage } from "@/auth/SignInPage";
import { ForgotPasswordPage } from "@/auth/ForgotPasswordPage";

import { DashboardPage } from "@/pages/DashboardPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { HsnLookupPage } from "@/pages/HsnLookupPage";
import { ImportEstimatorPage } from "@/pages/ImportEstimatorPage";
import { VendorsPage } from "@/pages/VendorsPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { GodownsPage } from "@/pages/GodownsPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProductsPage } from "@/pages/ProductsPage";
import { GrnListPage } from "@/pages/GrnListPage";
import { GrnCreatePage } from "@/pages/GrnCreatePage";
import { DcListPage } from "@/pages/DcListPage";
import { DcCreatePage } from "@/pages/DcCreatePage";
import { InvoicesPage } from "@/pages/InvoicesPage";
import { BillsPage } from "@/pages/BillsPage";
import { SystemSettingsPage } from "@/pages/SystemSettingsPage";
import { AuditLogPage } from "@/pages/AuditLogPage";
import { PurchaseOrdersPage } from "@/pages/PurchaseOrdersPage";
import { BoqUploadPage } from "@/pages/BoqUploadPage";
import { ServiceTicketsPage } from "@/pages/ServiceTicketsPage";
import { TransfersPage } from "@/pages/TransfersPage";
import { LabelPrinterPage } from "@/pages/LabelPrinterPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AmcContractsPage } from "@/pages/AmcContractsPage";
import { GrnDetailPage } from "@/pages/GrnDetailPage";
import { DcDetailPage } from "@/pages/DcDetailPage";
import { UserManagementPage } from "@/pages/UserManagementPage";
import { ClientPortalPage } from "@/pages/ClientPortalPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { NotFoundPage, ForbiddenPage, RouterErrorBoundary } from "@/pages/ErrorPages";
import { Skeleton } from "@/components/ui/skeleton";

const router = createBrowserRouter([
  { path: "/sign-in", element: <SignInPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/403", element: <ForbiddenPage /> },
  // Public client portal — token-authenticated, NO Cognito gate.
  // URL shape: /portal/:projectId?t=<opaque-token>
  { path: "/portal/:projectId", element: <ClientPortalPage /> },
  {
    element: <ProtectedRoute />,
    errorElement: <RouterErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "inventory", element: <InventoryPage /> },
          {
            path: "tools/hsn-lookup",
            element: (
              <ProtectedRoute roles={["Admin", "Logistics", "Purchase"]} />
            ),
            children: [{ index: true, element: <HsnLookupPage /> }],
          },
          {
            path: "tools/import-estimator",
            element: <ProtectedRoute roles={["Admin", "Purchase"]} />,
            children: [{ index: true, element: <ImportEstimatorPage /> }],
          },

          // --- Master data (implemented) ---
          { path: "products", element: <ProductsPage /> },
          { path: "vendors", element: <VendorsPage /> },
          { path: "clients", element: <ClientsPage /> },
          { path: "godowns", element: <ProtectedRoute roles={["Admin", "Logistics"]} />, children: [{ index: true, element: <GodownsPage /> }] },
          { path: "projects", element: <ProjectsPage /> },

          // --- GRN (implemented) ---
          {
            path: "grn",
            element: <ProtectedRoute roles={["Admin", "Logistics"]} />,
            children: [
              { index: true, element: <GrnListPage /> },
              { path: "new", element: <GrnCreatePage /> },
              { path: ":id", element: <GrnDetailPage /> },
            ],
          },

          // --- DC (implemented) ---
          {
            path: "dc",
            element: <ProtectedRoute roles={["Admin", "Logistics"]} />,
            children: [
              { index: true, element: <DcListPage /> },
              { path: "new", element: <DcCreatePage /> },
              { path: ":id", element: <DcDetailPage /> },
            ],
          },

          // --- Placeholders: backend is ready; UI slices follow per iteration ---
          { path: "transfers", element: <ProtectedRoute roles={["Admin", "Logistics"]} />, children: [{ index: true, element: <TransfersPage /> }] },
          { path: "service-tickets", element: <ProtectedRoute roles={["Admin", "Logistics"]} />, children: [{ index: true, element: <ServiceTicketsPage /> }] },
          { path: "pos", element: <ProtectedRoute roles={["Admin", "Purchase"]} />, children: [{ index: true, element: <PurchaseOrdersPage /> }] },
          { path: "boq", element: <ProtectedRoute roles={["Admin", "Purchase"]} />, children: [{ index: true, element: <BoqUploadPage /> }] },
          { path: "invoices", element: <InvoicesPage /> },
          { path: "bills", element: <ProtectedRoute roles="Admin" />, children: [{ index: true, element: <BillsPage /> }] },
          { path: "depreciation", element: <PlaceholderPage title="Depreciation schedule" spec="FY-wise depreciation per ASSET unit, monthly history, CSV export." /> },
          { path: "tally", element: <PlaceholderPage title="Tally export" spec="One-click TallyPrime XML export per GRN / DC with ledger-mapping validation." /> },
          { path: "admin/users", element: <ProtectedRoute roles="Admin" />, children: [{ index: true, element: <UserManagementPage /> }] },
          { path: "admin/audit", element: <ProtectedRoute roles="Admin" />, children: [{ index: true, element: <AuditLogPage /> }] },
          { path: "admin/settings", element: <ProtectedRoute roles="Admin" />, children: [{ index: true, element: <SystemSettingsPage /> }] },
          { path: "chatbot", element: <PlaceholderPage title="AV Inventory assistant" spec="Full-screen chat — for now use the floating widget in the bottom-right." /> },
          { path: "activity", element: <PlaceholderPage title="Activity feed" spec="Real-time event stream via AppSync subscription." /> },
          { path: "reports", element: <ProtectedRoute roles="Admin" />, children: [{ index: true, element: <ReportsPage /> }] },
          { path: "labels", element: <ProtectedRoute roles={["Admin", "Logistics"]} />, children: [{ index: true, element: <LabelPrinterPage /> }] },
          { path: "amc", element: <ProtectedRoute roles={["Admin", "Logistics"]} />, children: [{ index: true, element: <AmcContractsPage /> }] },

          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export default function App() {
  const refresh = useAuthStore((s) => s.refresh);

  // Hydrate auth on boot.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <Suspense fallback={<BootSkeleton />}>
        <RouterProvider router={router} />
      </Suspense>
      <Toaster />
    </>
  );
}

function BootSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    </div>
  );
}
