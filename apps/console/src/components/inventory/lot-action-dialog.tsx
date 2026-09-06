import {
  ApiError,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@roastery/ui";
import type * as React from "react";

/**
 * The shell every lot action shares.
 *
 * One place for the four things each of them would otherwise re-implement: the
 * blocked reason under the button, the pending state, the API's field errors,
 * and the fact that a failed submit must leave the dialog OPEN with everything
 * still typed. A form that closes on failure has thrown away the entry and the
 * explanation at the same moment.
 *
 * Deliberately not an AlertDialog even for a write-off. A second "are you
 * sure?" over a first dialog is a modal on a modal, and it guards nothing that
 * a button reading "Write off 12.5 kg" next to a required explanation does not
 * already guard. The consequence is in the label, where it can be read.
 */
export function LotActionDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  destructive,
  blockedBecause,
  isPending,
  error,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** Names the consequence, with its quantity, never "Confirm". */
  submitLabel: string;
  destructive?: boolean;
  /** Why the action cannot proceed yet. Shown, not hidden behind a disabled button. */
  blockedBecause: string | null;
  isPending: boolean;
  error: unknown;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  // Field errors belong beside their input; anything else is the one line the
  // dialog can show. `fields` is empty for a 500, which is what makes this
  // fall through to the message rather than rendering nothing.
  const fieldErrors = error instanceof ApiError ? Object.values(error.fields) : [];
  const message =
    fieldErrors.length > 0
      ? fieldErrors[0]
      : error instanceof Error
        ? error.message
        : error
          ? "That did not go through."
          : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (blockedBecause || isPending) return;
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">{children}</div>

          {message ? (
            <p
              role="alert"
              className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive text-sm"
            >
              {message}
            </p>
          ) : null}

          {/* Above the footer, not inside it: the footer reverses its order
              when it stacks, which put the reason for a disabled button
              underneath Cancel and two controls away from the button it
              explains. */}
          {blockedBecause ? (
            <p className="mb-3 text-muted-foreground text-xs">{blockedBecause}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={blockedBecause !== null || isPending}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
