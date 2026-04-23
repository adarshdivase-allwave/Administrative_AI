/**
 * Single source of truth for the sidebar — every nav entry is role-scoped,
 * so the same config powers permission checks on both links and command-
 * palette entries. Keep these in sync with routes in App.tsx.
 */
import type { UserRole } from "@shared/constants";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  Truck,
  Receipt,
  FileText,
  ShoppingCart,
  Settings,
  Bell,
  Search,
  DollarSign,
  Users,
  Building2,
  Briefcase,
  Bot,
  FileSpreadsheet,
  ClipboardList,
  Wrench,
  BadgeIndianRupee,
  HardDrive,
  Plane,
  Tag,
  Calculator,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: UserRole[];
  /** Shortcut shown in the command palette (e.g. "g d" for Dashboard). */
  shortcut?: string;
  /** Grouping label for the sidebar. */
  group: "Overview" | "Inventory" | "Procurement" | "Finance" | "Admin" | "Tools";
}

export const NAV_ITEMS: NavItem[] = [
  // --- Overview ---
  { label: "Dashboard", to: "/", icon: LayoutDashboard, roles: ["Admin", "Logistics", "Purchase", "Sales"], group: "Overview", shortcut: "g d" },
  { label: "Activity feed", to: "/activity", icon: Bell, roles: ["Admin", "Logistics", "Purchase", "Sales"], group: "Overview" },

  // --- Inventory ---
  { label: "Inventory", to: "/inventory", icon: Package, roles: ["Admin", "Logistics", "Purchase", "Sales"], group: "Inventory", shortcut: "g i" },
  { label: "Products", to: "/products", icon: Tag, roles: ["Admin", "Logistics", "Purchase", "Sales"], group: "Inventory" },
  { label: "Godowns", to: "/godowns", icon: Warehouse, roles: ["Admin", "Logistics"], group: "Inventory" },
  { label: "GRN", to: "/grn", icon: ClipboardList, roles: ["Admin", "Logistics"], group: "Inventory", shortcut: "g g" },
  { label: "Delivery Challans", to: "/dc", icon: Truck, roles: ["Admin", "Logistics"], group: "Inventory", shortcut: "g c" },
  { label: "Transfers", to: "/transfers", icon: Plane, roles: ["Admin", "Logistics"], group: "Inventory" },
  { label: "Service tickets", to: "/service-tickets", icon: Wrench, roles: ["Admin", "Logistics"], group: "Inventory" },
  { label: "Print QR labels", to: "/labels", icon: Tag, roles: ["Admin", "Logistics"], group: "Inventory" },
  { label: "AMC contracts", to: "/amc", icon: FileText, roles: ["Admin", "Logistics"], group: "Inventory" },

  // --- Procurement ---
  { label: "Purchase orders", to: "/pos", icon: ShoppingCart, roles: ["Admin", "Purchase"], group: "Procurement", shortcut: "g p" },
  { label: "Vendors", to: "/vendors", icon: Building2, roles: ["Admin", "Purchase", "Logistics"], group: "Procurement" },
  { label: "BOQ upload", to: "/boq", icon: FileSpreadsheet, roles: ["Admin", "Purchase"], group: "Procurement" },
  { label: "HSN Lookup", to: "/tools/hsn-lookup", icon: Search, roles: ["Admin", "Logistics", "Purchase"], group: "Tools", shortcut: "g h" },
  { label: "Import cost estimator", to: "/tools/import-estimator", icon: Calculator, roles: ["Admin", "Purchase"], group: "Tools" },

  // --- Finance ---
  { label: "Clients", to: "/clients", icon: Users, roles: ["Admin", "Sales", "Logistics"], group: "Finance" },
  { label: "Projects", to: "/projects", icon: Briefcase, roles: ["Admin", "Logistics", "Sales"], group: "Finance" },
  { label: "Invoices", to: "/invoices", icon: Receipt, roles: ["Admin", "Sales"], group: "Finance", shortcut: "g v" },
  { label: "Bills & obligations", to: "/bills", icon: BadgeIndianRupee, roles: ["Admin"], group: "Finance" },
  { label: "Depreciation", to: "/depreciation", icon: DollarSign, roles: ["Admin"], group: "Finance" },
  { label: "Tally export", to: "/tally", icon: FileText, roles: ["Admin"], group: "Finance" },

  // --- Admin ---
  { label: "Users", to: "/admin/users", icon: Users, roles: ["Admin"], group: "Admin" },
  { label: "Audit log", to: "/admin/audit", icon: FileText, roles: ["Admin"], group: "Admin" },
  { label: "System Settings", to: "/admin/settings", icon: Settings, roles: ["Admin"], group: "Admin", shortcut: "g s" },

  // --- Tools ---
  { label: "Assistant", to: "/chatbot", icon: Bot, roles: ["Admin", "Logistics", "Purchase", "Sales"], group: "Tools" },
  { label: "Reports", to: "/reports", icon: HardDrive, roles: ["Admin"], group: "Tools" },
];

export const NAV_GROUPS: NavItem["group"][] = [
  "Overview",
  "Inventory",
  "Procurement",
  "Finance",
  "Tools",
  "Admin",
];
