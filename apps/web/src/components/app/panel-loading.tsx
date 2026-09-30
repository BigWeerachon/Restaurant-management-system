import { Skeleton } from "@/components/ui/feedback";

/** Stands in for a panel whose code is still on its way (the sign-in, the sign-up form, …): the same height, and a word for screen readers. */
export function PanelLoading({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <Skeleton className="h-7 w-2/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
      <span className="sr-only">กำลังโหลด</span>
    </div>
  );
}
