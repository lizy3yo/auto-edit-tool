import { useState, useEffect, useCallback } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * Global credit error state — any component can trigger the popup.
 */
let showCreditErrorFn: (() => void) | null = null;

/**
 * Call this from anywhere to show the credit error popup.
 */
export function triggerCreditErrorPopup() {
  showCreditErrorFn?.();
}

/**
 * Full-screen popup shown to ALL users when a credit-related error occurs.
 * Message: "API has no more credits. Please notify Shua on Discord."
 * No mention of GenAI.
 */
export function CreditErrorPopup() {
  const [open, setOpen] = useState(false);

  const show = useCallback(() => setOpen(true), []);

  useEffect(() => {
    showCreditErrorFn = show;
    return () => {
      showCreditErrorFn = null;
    };
  }, [show]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <AlertDialogTitle className="text-lg">
              API has no more credits
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-base mt-3 leading-relaxed">
            API has no more credits. Please notify Shua on Discord.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={() => setOpen(false)}>OK</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
