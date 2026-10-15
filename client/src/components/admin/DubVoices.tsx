import { useEffect, useState } from "react";
import { Languages, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  dubLanguageCode,
  dubLanguagesError,
  DUB_TTS_MODEL,
  type DubLanguage,
} from "@shared/dubCta";

/**
 * Admin → Dub voices: the languages the Dub CTAs page makes clips in, and the 69Labs voice each
 * is spoken in. One voice per language for every channel (`shared/dubCta.ts`).
 */
export function DubVoices() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.dubCta.languages.useQuery();
  const [rows, setRows] = useState<DubLanguage[] | null>(null);
  useEffect(() => {
    if (data && rows === null) setRows(data);
  }, [data, rows]);
  const save = trpc.dubCta.setLanguages.useMutation({
    onSuccess: async () => {
      await utils.dubCta.languages.invalidate();
      setRows(null);
      toast.success("Dub voices saved");
    },
    onError: err => toast.error(err.message),
  });

  if (isLoading || !rows)
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  const error = dubLanguagesError(rows);
  const changed = JSON.stringify(rows) !== JSON.stringify(data);
  const update = (i: number, patch: Partial<DubLanguage>) =>
    setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Languages className="h-4 w-4" />
          Dub voices
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          The languages the Add-ons page's Dub CTAs tab makes clips in, and the voice each is spoken in — the
          same voice for every channel. Use a 69Labs voice id; it is voiced on {DUB_TTS_MODEL}.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.code} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Language"
                className="w-44"
                value={r.name}
                onChange={e => update(i, { name: e.target.value })}
              />
              <Input
                aria-label={`${r.name} voice id`}
                className="w-64 font-mono text-xs"
                placeholder="Voice id (not set)"
                value={r.voiceId}
                onChange={e => update(i, { voiceId: e.target.value.trim() })}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${r.name}`}
                onClick={() => setRows(rows.filter((_, k) => k !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setRows([
                ...rows,
                {
                  code: dubLanguageCode(
                    "new language",
                    rows.map(r => r.code)
                  ),
                  name: "",
                  voiceId: "",
                },
              ])
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add language
          </Button>
          <Button
            size="sm"
            disabled={!changed || !!error || save.isPending}
            onClick={() =>
              save.mutate({
                // A new row's key is made from its name when it is first saved.
                languages: rows.map(r =>
                  r.code.startsWith("new-language") && r.name.trim()
                    ? {
                        ...r,
                        code: dubLanguageCode(
                          r.name,
                          rows.filter(o => o !== r).map(o => o.code)
                        ),
                      }
                    : r
                ),
              })
            }
          >
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          {changed && error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          Removing a language hides its books and clips on the Add-ons page; nothing is
          deleted.
        </p>
      </CardContent>
    </Card>
  );
}
