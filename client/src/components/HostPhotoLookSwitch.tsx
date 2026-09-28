import { Loader2 } from "lucide-react";
import { HOST_PHOTO_LOOK_LABEL, type HostPhotoLookState } from "@shared/hostPhotoLook";

/**
 * The "Phone look / Original" switch under a host photo — the same control in the generate
 * form's picker, the HeyGen test and Admin (shared/hostPhotoLook.ts is the rule behind it).
 * The phone look is the default; while it is being made (or after it failed) the label says so
 * and the original is what renders.
 */
export function PhotoLookSwitch({
  state,
  onChange,
  disabled,
}: {
  state: HostPhotoLookState;
  onChange: (useOriginal: boolean) => void;
  disabled?: boolean;
}) {
  const phoneOn = state !== "original";
  const option = (label: string, on: boolean, useOriginal: boolean) => (
    <button
      type="button"
      disabled={disabled || on}
      aria-pressed={on}
      onClick={() => onChange(useOriginal)}
      title={useOriginal ? "Use the photo as uploaded" : "Use the phone-look version (the default)"}
      className={`flex-1 whitespace-nowrap rounded px-1 py-0.5 ${on ? "bg-primary text-primary-foreground" : "hover:bg-secondary"} disabled:cursor-default`}
    >
      {label}
    </button>
  );
  return (
    <div className="mt-1 space-y-0.5">
      <div className="flex gap-0.5 rounded border border-border p-0.5 text-[10px]">
        {option("Phone", phoneOn, false)}
        {option("Original", !phoneOn, true)}
      </div>
      {(state === "making" || state === "failed") && (
        <p
          className={`flex items-center gap-1 text-[10px] ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {state === "making" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          {HOST_PHOTO_LOOK_LABEL[state]}
        </p>
      )}
    </div>
  );
}
