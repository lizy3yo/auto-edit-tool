import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type ChannelDubVoices as Voices,
  channelDubVoicesError,
  type DubLanguage,
  dubVoiceFor,
} from "@shared/dubCta";

/**
 * Admin → Channels → Dub voices: the voice this channel's dub CTAs speak in, per language
 * (`channel_configs.dubVoices`). Staged with the rest of the channel form and saved by its Save
 * Configuration, so the review step lists a changed voice beside every other field. A blank row
 * means this channel makes no clips in that language — there is no default to fall back to.
 */
export function ChannelDubVoices({
  languages,
  value,
  onChange,
}: {
  languages: DubLanguage[];
  value: Voices;
  onChange: (next: Voices) => void;
}) {
  if (!languages.length) return null;
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
          Dub voices
        </h4>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          The voice this channel&apos;s dubbed calls to action speak in, so each language sounds
          like this host. A 69Labs / ElevenLabs library voice id that is native to the language.
          A language left blank has no clips made for this channel.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {languages.map(language => {
          const typed = value[language.code] ?? "";
          const used = dubVoiceFor(language, { [language.code]: typed });
          const error = typed.trim()
            ? channelDubVoicesError({ [language.code]: typed })
            : null;
          const id = `dub-voice-${language.code}`;
          return (
            <div key={language.code}>
              <Label className="text-xs" htmlFor={id}>
                {language.name}
              </Label>
              <Input
                id={id}
                value={typed}
                onChange={e => onChange({ ...value, [language.code]: e.target.value })}
                placeholder="Voice id"
                className="mt-1 h-8 font-mono text-xs"
                aria-invalid={!!error}
                spellCheck={false}
                autoComplete="off"
              />
              <p
                className={`mt-1 text-[11px] leading-snug ${error ? "text-destructive" : "text-muted-foreground"}`}
              >
                {error
                  ? "That does not look like a voice id."
                  : used.source === "channel"
                    ? "This channel's own voice."
                    : `No voice — enter one to make ${language.name} clips.`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
