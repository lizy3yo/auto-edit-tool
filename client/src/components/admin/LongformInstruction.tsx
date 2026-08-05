import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Film } from "lucide-react";
import { toast } from "sonner";

/**
 * Admin editor for the long-form video "instruction prompt" — the directing block
 * (host identity/look, b-roll style, tone, framing) applied to EVERY long-form
 * session. It shapes only the visuals/storyboard; it is never voiced. The spoken
 * audio is always the user's pasted script. Stored in app_settings.
 */
export function LongformInstruction() {
  const { data, isLoading } =
    trpc.longformVideo.getInstructionPrompt.useQuery();
  const utils = trpc.useUtils();
  const [content, setContent] = useState("");

  useEffect(() => {
    if (data?.content !== undefined) setContent(data.content);
  }, [data?.content]);

  const saveMutation = trpc.longformVideo.setInstructionPrompt.useMutation({
    onSuccess: () => {
      toast.success("Longform instruction saved.");
      utils.longformVideo.getInstructionPrompt.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to save."),
  });

  const handleSave = () => {
    const trimmed = content.trim();
    if (!trimmed) {
      toast.error("Instruction cannot be empty.");
      return;
    }
    saveMutation.mutate({ content: trimmed });
  };

  const dirty = data?.content !== undefined && content !== data.content;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Film className="h-4 w-4" />
          Longform Instruction
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-2">
          Directing guidance applied to every long-form video session — host
          look, b-roll style, tone, and framing. It shapes only the visuals;{" "}
          <strong>it is never spoken</strong>. The narration is always the
          pasted script, word-for-word.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <Textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Directing instruction…"
              className="font-mono text-sm min-h-[320px] resize-y"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {data?.isDefault
                  ? "Using the built-in default (no saved override yet)."
                  : "Custom override is active."}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setContent(data?.default ?? "")}
                  disabled={saveMutation.isPending}
                >
                  Restore default
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending || !dirty}
                >
                  {saveMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
