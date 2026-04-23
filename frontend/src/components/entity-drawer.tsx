import * as React from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InlineSpinner } from "@/components/data-table";

interface EntityDrawerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  entityName: string;
  description?: string;
  onSubmit: () => void | Promise<void>;
  submitting?: boolean;
  children: React.ReactNode;
}

/**
 * Wraps a create/edit form in a consistent side drawer so every CRUD module
 * feels the same and we don't waste UI screen real estate on a full page
 * navigation for simple record edits.
 */
export function EntityDrawer({
  open,
  onOpenChange,
  mode,
  entityName,
  description,
  onSubmit,
  submitting,
  children,
}: EntityDrawerProps) {
  const title = mode === "create" ? `New ${entityName}` : `Edit ${entityName}`;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto py-4 space-y-4">{children}</div>
          <SheetFooter className="border-t pt-4 mt-auto">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <InlineSpinner />}
              {mode === "create" ? "Create" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
