import {
  BookOpen,
  ChartColumnBig,
  ChefHat,
  ClipboardCheck,
  Moon,
  Package,
  PackagePlus,
  Receipt,
  Settings,
  Store,
  Sun,
  Trash2,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Icon names used by the domain (navigation, quick actions) → Lucide components. */
const ICONS: Record<string, LucideIcon> = {
  sun: Sun,
  store: Store,
  "chef-hat": ChefHat,
  receipt: Receipt,
  package: Package,
  "book-open": BookOpen,
  truck: Truck,
  wallet: Wallet,
  chart: ChartColumnBig,
  users: Users,
  settings: Settings,
  "package-plus": PackagePlus,
  trash: Trash2,
  "clipboard-check": ClipboardCheck,
  moon: Moon,
};

export function Icon({ name, className, strokeWidth = 2 }: { name: string; className?: string; strokeWidth?: number }) {
  const Cmp = ICONS[name] ?? Package;
  return <Cmp className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
