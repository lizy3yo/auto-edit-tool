import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageIcon, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { MAX_JOB_ASSETS } from "@shared/pacing";
import type { LongformAsset } from "@shared/types";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Per-job asset uploader: images shown VERBATIM inside the video's CTA pitch (book renders,
 * product shots). Per job rather than per channel because these change every video, unlike the
 * host photo / cover / QR that live on the channel.
 *
 * Each asset takes one person-free beat of the pitch and is rendered as-is — no generation, no
 * cost. The caption (when captions are enabled in Admin → Longform Pacing) is burned bottom-centre
 * so the beat stays readable at arm's length.
 */
export function LongformAssets({
  assets,
  onChange,
  disabled,
}: {
  assets: LongformAsset[];
  onChange: (next: LongformAsset[]) => void;
  disabled?: boolean;
}) {
  const { data: pacing } = trpc.longformVideo.getPacing.useQuery();
  const captionsOn = pacing?.pacing.captions.enabled ?? false;

  const upload = trpc.styleReference.upload.useMutation({
    onSuccess: ({ url }) => onChange([...assets, { url }]),
    onError: err => toast.error(err.message),
  });

  const full = assets.length >= MAX_JOB_ASSETS;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">
        Assets{" "}
        <span className="text-muted-foreground font-normal">(optional)</span>
      </Label>
      <p className="text-xs text-muted-foreground">
        Images shown exactly as uploaded during this video's call-to-action —
        book renders, product shots. Each one takes a beat of the pitch and
        carries the QR code, so viewers can scan while it's on screen. Up to{" "}
        {MAX_JOB_ASSETS}.
        {!captionsOn && assets.length > 0 && (
          <>
            {" "}
            Captions are currently off in Admin → Longform Pacing, so these will
            render without text.
          </>
        )}
      </p>

      {assets.length > 0 && (
        <div className="space-y-2">
          {assets.map((a, i) => (
            <div
              key={`${a.url}-${i}`}
              className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 p-2"
            >
              <img
                src={a.url}
                alt={`Asset ${i + 1}`}
                className="h-14 w-14 shrink-0 rounded border border-border object-contain bg-white"
              />
              <Input
                value={a.caption ?? ""}
                disabled={disabled}
                maxLength={200}
                placeholder={
                  captionsOn
                    ? "Caption (optional) — burned on screen"
                    : "Caption (captions are off in Admin)"
                }
                onChange={e => {
                  const next = assets.slice();
                  next[i] = { ...a, caption: e.target.value };
                  onChange(next);
                }}
                className="h-8 border-border text-sm"
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                className="h-8 w-8 shrink-0 p-0"
                aria-label={`Remove asset ${i + 1}`}
                onClick={() => onChange(assets.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {full ? (
        <p className="text-xs text-muted-foreground italic">
          {MAX_JOB_ASSETS} assets is the maximum — the pitch has only so many
          beats to place them on.
        </p>
      ) : (
        <label
          className={`inline-flex items-center gap-2 h-8 px-3 rounded-md border border-dashed border-border bg-secondary/30 text-xs text-muted-foreground ${
            disabled || upload.isPending
              ? "opacity-50"
              : "cursor-pointer hover:text-foreground hover:bg-secondary/50"
          }`}
        >
          {upload.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {upload.isPending ? "Uploading…" : "Add asset image"}
          <input
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            disabled={disabled || upload.isPending}
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!ACCEPTED.includes(file.type)) {
                toast.error("Use a JPG, PNG, or WEBP image.");
                return;
              }
              if (file.size > MAX_BYTES) {
                toast.error("Image must be under 10 MB");
                return;
              }
              const reader = new FileReader();
              reader.onload = () =>
                upload.mutate({ dataUrl: reader.result as string });
              reader.readAsDataURL(file);
            }}
          />
        </label>
      )}
    </div>
  );
}
