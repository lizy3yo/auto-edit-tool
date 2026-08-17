import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageIcon, Images, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

/**
 * A channel's CTA ASSETS — images shown verbatim during the pitch of every video on the channel.
 *
 * The counterpart to `ChannelBooks`, and it lives here for the same reason: an asset belongs to
 * exactly one channel, so the channel editor is where it is configured. It replaces a per-video
 * upload that made the operator re-attach the same product shots on every render — now they are
 * set once and reused.
 *
 * Every active asset appears in every video's CTA (there is no per-video picking, by design). An
 * asset is just an image plus an optional caption; the QR that rides on its beat is the
 * channel/book QR, so there is no shop link here.
 *
 * `channelKey` is supplied by the editor, so there is no channel selector — the channel on screen
 * IS the scope. Rows write immediately (add/save/remove), independent of the channel's own Save
 * Configuration, exactly like books.
 */

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export function ChannelAssets({ channelKey }: { channelKey: string }) {
  const utils = trpc.useUtils();
  const [caption, setCaption] = useState("");

  const { data: assets, isLoading } = trpc.channelAsset.list.useQuery(
    { channelKey, activeOnly: false },
    { enabled: !!channelKey }
  );

  const { data: pacing } = trpc.longformVideo.getPacing.useQuery();
  const captionsOn = pacing?.pacing.captions.enabled ?? false;

  const save = trpc.channelAsset.save.useMutation({
    onSuccess: () => {
      utils.channelAsset.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const upload = trpc.styleReference.upload.useMutation({
    onSuccess: ({ url }) => {
      // The upload only puts the file on R2; the row is created here, carrying the caption the
      // operator typed for it (cleared afterwards so the next upload starts fresh).
      save.mutate(
        { channelKey, imageUrl: url, caption: caption.trim() || null },
        { onSuccess: () => setCaption("") }
      );
    },
    onError: err => toast.error(err.message),
  });

  const remove = trpc.channelAsset.deactivate.useMutation({
    onSuccess: () => {
      toast.success(
        "Asset removed — videos that already used it are unaffected."
      );
      utils.channelAsset.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const active = (assets ?? []).filter(a => a.isActive);
  const busy = upload.isPending || save.isPending;

  return (
    <div className="space-y-3">
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <Images className="h-3.5 w-3.5" />
          CTA assets
        </Label>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Images shown exactly as uploaded during this channel&apos;s
          call-to-action — product shots, extra renders. Every video on the
          channel shows all of them, each on its own beat carrying the QR.
          {!captionsOn && active.length > 0 && (
            <>
              {" "}
              Captions are off in Admin → Longform Pacing, so these render
              without text.
            </>
          )}
        </p>
        {/* Same note as the books list — these write on their own, not with Save Configuration. */}
        <p className="mt-1 text-[11px] italic text-muted-foreground">
          Assets save on their own — Save Configuration below covers the channel
          fields, not this list.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : active.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground">
          No assets yet. Add the first below.
        </p>
      ) : (
        <div className="space-y-2">
          {active.map(a => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-md border border-border p-2"
            >
              <img
                src={a.imageUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded border border-border bg-white object-contain"
              />
              <Input
                value={a.caption ?? ""}
                maxLength={200}
                placeholder={
                  captionsOn
                    ? "Caption (optional) — burned on screen"
                    : "Caption (captions are off in Admin)"
                }
                onChange={e =>
                  save.mutate({
                    id: a.id,
                    channelKey,
                    imageUrl: a.imageUrl,
                    caption: e.target.value || null,
                  })
                }
                className="h-8 text-sm"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0"
                aria-label="Remove asset"
                onClick={() => remove.mutate({ id: a.id })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <Label className="text-xs">Add an asset</Label>
        <Input
          value={caption}
          maxLength={200}
          placeholder="Caption for the next upload (optional)"
          onChange={e => setCaption(e.target.value)}
          className="h-8 text-xs"
        />
        <label
          className={`inline-flex h-8 items-center gap-2 rounded-md border border-dashed border-border bg-secondary/30 px-3 text-xs text-muted-foreground ${
            busy
              ? "opacity-50"
              : "cursor-pointer hover:bg-secondary/50 hover:text-foreground"
          }`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {busy ? "Uploading…" : "Upload asset image"}
          <input
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            disabled={busy}
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!ACCEPTED.includes(file.type))
                return toast.error("Use a JPG, PNG, or WEBP image.");
              if (file.size > MAX_BYTES)
                return toast.error("Image must be under 10 MB");
              const reader = new FileReader();
              reader.onload = () =>
                upload.mutate({ dataUrl: reader.result as string });
              reader.readAsDataURL(file);
            }}
          />
        </label>
      </div>
    </div>
  );
}
