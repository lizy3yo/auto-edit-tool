import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  ImagePlus,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useCanEditChannel } from "@/hooks/useMayEdit";
import { downloadFile } from "@/lib/download";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Thumb } from "@/components/Thumb";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  clipMatchesScript,
  clipUsesBroll,
  DUB_BOOK_TOKEN,
  DUB_BROLL_SLOTS,
  DUB_CTA_PARTS,
  DUB_CTA_POSITIONS,
  DUB_POSITION_LABEL,
  DUB_SCRIPT_AIM_SEC,
  dubLanguageBlocker,
  dubScriptError,
  dubScriptLength,
  dubVoiceFor,
  parseChannelDubVoices,
  parseDubBroll,
  type ChannelDubVoices,
  type DubBrollSet,
  type DubCtaPosition,
  type DubCtaScript,
  type DubLanguage,
} from "@shared/dubCta";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

type Book = {
  language: string;
  title: string;
  coverImageUrl: string | null;
  shopUrl: string | null;
};
type Clip = {
  language: string;
  position: string;
  state: "working" | "done" | "failed" | "interrupted";
  phase: string | null;
  error: string | null;
  videoUrl: string | null;
  script: string | null;
  bookTitle: string | null;
  durationMs: number | null;
};
type Script = {
  language: string;
  position: string;
  text: string;
  english: string | null;
};
type Broll = {
  position: string;
  state: "working" | "done" | "failed" | "interrupted";
  pictures: string | null;
  error: string | null;
};

/** The language card's id, so the warning box can jump to it. */
const cardId = (code: string) => `dub-language-${code}`;

/**
 * Dub CTAs: a channel's faceless call to action in each dubbing language, mid-video and end of
 * video (`shared/dubCta.ts`). Each language's book is set here; its voice is the channel's own
 * (Admin → Channels → Dub voices) — a language with none has no clips made.
 * The Add-ons page's "Dub CTAs" tab: the channel is picked once at the top of that page.
 */
export function DubCta({ channelKey }: { channelKey: string }) {
  const utils = trpc.useUtils();
  const { data: channels } = trpc.channelConfig.list.useQuery();
  const { data: languages } = trpc.dubCta.languages.useQuery();
  const channel = channels?.find(c => c.channelKey === channelKey);
  const mayEdit = useCanEditChannel(channelKey);
  const [picked, setPicked] = useState<string[]>([]);

  const list = trpc.dubCta.list.useQuery(
    { channelKey },
    {
      enabled: !!channel,
      refetchInterval: q =>
        q.state.data?.clips.some(c => c.state === "working") ||
        q.state.data?.broll?.some(b => b.state === "working")
          ? 4000
          : false,
    }
  );
  const books = (list.data?.books ?? []) as Book[];
  const brollRows = (list.data?.broll ?? []) as Broll[];
  // The channel's shared pictures per position — what every language's clip of it is built from.
  const brollFor = (position: DubCtaPosition) =>
    parseDubBroll(brollRows.find(b => b.position === position)?.pictures);
  const clips = (list.data?.clips ?? []) as Clip[];
  const scripts = (list.data?.scripts ?? []) as Script[];
  const bookFor = (code: string) => books.find(b => b.language === code);
  // The channel's own voice per language (Admin → Channels → Dub voices) wins over the default.
  const channelVoices = useMemo(
    () => parseChannelDubVoices(channel?.dubVoices),
    [channel?.dubVoices]
  );
  const blockerFor = (l: DubLanguage) =>
    dubLanguageBlocker(l, bookFor(l.code), channelVoices);
  // Any language can be ticked; the ones not ready are named in a warning box at Make clips.
  const [warnOpen, setWarnOpen] = useState(false);
  const pickedLanguages = (languages ?? []).filter(l =>
    picked.includes(l.code)
  );
  const pickedNotReady = pickedLanguages.filter(l => blockerFor(l));
  const pickedReady = pickedLanguages.filter(l => !blockerFor(l));

  const start = trpc.dubCta.start.useMutation({
    onSuccess: async ({ started }) => {
      await utils.dubCta.list.invalidate({ channelKey });
      toast.success(
        started
          ? `Making ${started} clip${started === 1 ? "" : "s"} — a few minutes each.`
          : "Those clips are already being made."
      );
    },
    onError: err => toast.error(err.message),
  });

  const allPicked = !!languages?.length && picked.length === languages.length;
  const makeClips = () => {
    if (pickedNotReady.length) return setWarnOpen(true);
    start.mutate({ channelKey, languages: picked });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Make dub CTAs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {channel && languages && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">Languages</Label>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={allPicked}
                      disabled={!mayEdit}
                      onChange={() =>
                        setPicked(allPicked ? [] : languages.map(l => l.code))
                      }
                    />
                    All
                  </label>
                  {languages.map(l => {
                    const blocker = blockerFor(l);
                    return (
                      <label
                        key={l.code}
                        className="flex items-center gap-2 text-sm"
                        title={blocker ?? undefined}
                      >
                        <input
                          type="checkbox"
                          checked={picked.includes(l.code)}
                          disabled={!mayEdit}
                          onChange={() =>
                            setPicked(p =>
                              p.includes(l.code)
                                ? p.filter(c => c !== l.code)
                                : [...p, l.code]
                            )
                          }
                        />
                        {l.name}
                        {blocker && (
                          <AlertTriangle
                            className="h-3.5 w-3.5 text-amber-600"
                            aria-label="Not ready"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
              <Button
                disabled={!picked.length || start.isPending || !mayEdit}
                onClick={makeClips}
              >
                {start.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                {picked.length
                  ? `Make ${picked.length * 2} clips (${picked.length} language${picked.length === 1 ? "" : "s"}, mid + end)`
                  : "Make clips"}
              </Button>
              {!mayEdit && (
                <p className="text-xs text-muted-foreground">
                  View only — this channel was made by someone else.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* What a ticked language still needs, named in one box rather than a standing list. */}
      <AlertDialog open={warnOpen} onOpenChange={setWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              {pickedNotReady.length === 1
                ? `${pickedNotReady[0].name} isn't ready`
                : `${pickedNotReady.length} languages aren't ready`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pickedNotReady.length === 1 ? "It" : "These"} won&apos;t be made
              until {pickedNotReady.length === 1 ? "it has" : "they have"}{" "}
              what&apos;s missing:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 text-sm">
            {pickedNotReady.map(l => (
              <li
                key={l.code}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span>
                  <span className="font-medium">{l.name}:</span> {blockerFor(l)}
                </span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => {
                    setWarnOpen(false);
                    document
                      .getElementById(cardId(l.code))
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Go to {l.name}
                </Button>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {pickedReady.length > 0 && (
              <Button
                disabled={start.isPending}
                onClick={() => {
                  setWarnOpen(false);
                  start.mutate({
                    channelKey,
                    languages: pickedReady.map(l => l.code),
                  });
                }}
              >
                {pickedReady.length === 1
                  ? `Make ${pickedReady[0].name} only`
                  : `Make the ${pickedReady.length} ready ones`}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {channel && (
        <SharedBroll
          channelKey={channelKey}
          rows={brollRows}
          clips={clips}
          mayEdit={mayEdit}
        />
      )}

      {channel &&
        (languages ?? []).map(l => (
          <LanguageCard
            key={l.code}
            channelKey={channelKey}
            channelName={channel.displayName ?? channelKey}
            language={l}
            book={bookFor(l.code)}
            booksLoaded={list.isSuccess}
            clips={clips.filter(c => c.language === l.code)}
            scripts={scripts.filter(s => s.language === l.code)}
            broll={{ mid: brollFor("mid"), end: brollFor("end") }}
            channelVoices={channelVoices}
            mayEdit={mayEdit}
          />
        ))}
    </div>
  );
}

function LanguageCard({
  channelKey,
  channelName,
  language,
  book,
  booksLoaded,
  clips,
  scripts,
  broll,
  channelVoices,
  mayEdit,
}: {
  channelKey: string;
  channelName: string;
  language: DubLanguage;
  book: Book | undefined;
  booksLoaded: boolean;
  clips: Clip[];
  scripts: Script[];
  broll: Record<DubCtaPosition, DubBrollSet | null>;
  channelVoices: ChannelDubVoices;
  mayEdit: boolean;
}) {
  const voice = dubVoiceFor(language, channelVoices);
  const blocker = dubLanguageBlocker(language, book, channelVoices);
  return (
    <Card id={cardId(language.code)} className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {language.name}
          {blocker && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/50 text-[10px] font-normal text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-3 w-3" />
              {blocker}
            </Badge>
          )}
          {voice.source === "none" ? (
            <Badge variant="destructive">
              No voice — set one in Admin → Channels → Dub voices
            </Badge>
          ) : (
            <Badge
              variant="default"
              className="gap-1 text-[10px] font-normal"
              title="This channel's own voice for the language (Admin → Channels)"
            >
              {`${channelName}'s voice`}
              <span className="font-mono">{voice.voiceId}</span>
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <BookForm
          key={`${channelKey}:${language.code}`}
          channelKey={channelKey}
          language={language}
          book={book}
          booksLoaded={booksLoaded}
          mayEdit={mayEdit}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {DUB_CTA_POSITIONS.map(position => {
            const script = scripts.find(s => s.position === position);
            const clip = clips.find(c => c.position === position);
            return (
              <div key={position} className="min-w-0 space-y-3">
                <ScriptBox
                  channelKey={channelKey}
                  language={language}
                  position={position}
                  saved={script}
                  bookTitle={book?.title ?? null}
                  mayEdit={mayEdit}
                />
                <ClipSlot
                  position={position}
                  clip={clip}
                  script={script}
                  broll={broll[position]}
                  fileName={`${channelName} - ${language.name} - ${DUB_POSITION_LABEL[position]}.mp4`}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function BookForm({
  channelKey,
  language,
  book,
  booksLoaded,
  mayEdit,
}: {
  channelKey: string;
  language: DubLanguage;
  book: Book | undefined;
  /** The saved books have arrived, so `book` undefined means "none saved", not "not loaded". */
  booksLoaded: boolean;
  mayEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(book?.title ?? "");
  const [shopUrl, setShopUrl] = useState(book?.shopUrl ?? "");
  const [cover, setCover] = useState<string | null>(
    book?.coverImageUrl ?? null
  );
  // The saved book arrives after the first render; take it once, never over typing.
  const [loaded, setLoaded] = useState(!!book);
  useEffect(() => {
    if (loaded || !book) return;
    setTitle(book.title);
    setShopUrl(book.shopUrl ?? "");
    setCover(book.coverImageUrl);
    setLoaded(true);
  }, [book, loaded]);

  // Two ways to set the book: pick one of the channel's own books (Channels → Books) from a
  // dropdown, or enter the cover, title and link by hand. A channel with no books has only the
  // manual form. Either way it is saved as this language's book.
  const { data: channelBooks } = trpc.book.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channelKey }
  );
  const hasChannelBooks = !!channelBooks?.length;
  const [source, setSource] = useState<"channel" | "manual" | null>(null);
  const [pickedId, setPickedId] = useState<string>("");
  useEffect(() => {
    if (source || !channelBooks || !booksLoaded) return;
    // Open on the option the saved book came from: an exact copy of a channel book (same
    // title, link and cover) is "From channel"; a book entered or edited by hand, or a channel
    // with no books, is "Upload manually"; nothing saved yet starts on the dropdown.
    const match = book
      ? channelBooks.find(
          b =>
            b.title === book.title &&
            (b.shopUrl ?? "") === (book.shopUrl ?? "") &&
            (b.coverImageUrl ?? null) === (book.coverImageUrl ?? null)
        )
      : undefined;
    if (match) setPickedId(String(match.id));
    setSource(match || (!book && channelBooks.length) ? "channel" : "manual");
  }, [source, channelBooks, book, booksLoaded]);
  // With no channel books there is nothing to pick, whatever was chosen before.
  const mode = channelBooks && !hasChannelBooks ? "manual" : source;
  const pickedBook = channelBooks?.find(b => String(b.id) === pickedId);
  const pickChannelBook = (id: string) => {
    const picked = channelBooks?.find(b => String(b.id) === id);
    if (!picked) return;
    setPickedId(id);
    setTitle(picked.title);
    setShopUrl(picked.shopUrl ?? "");
    setCover(picked.coverImageUrl);
  };

  const upload = trpc.styleReference.upload.useMutation({
    onSuccess: ({ url }) => setCover(url),
    onError: err => toast.error(err.message),
  });
  const save = trpc.dubCta.saveBook.useMutation({
    onSuccess: async () => {
      await utils.dubCta.list.invalidate({ channelKey });
      toast.success(`${language.name} book saved`);
    },
    onError: err => toast.error(err.message),
  });
  const changed =
    title.trim() !== (book?.title ?? "") ||
    shopUrl.trim() !== (book?.shopUrl ?? "") ||
    cover !== (book?.coverImageUrl ?? null);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">The {language.name} book</p>
      {mode === null ? (
        <div className="flex h-8 items-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs
          value={mode}
          onValueChange={v => {
            setSource(v as "channel" | "manual");
            // Back on the dropdown, the form shows the picked book again, not hand edits.
            if (v === "channel" && pickedId) pickChannelBook(pickedId);
          }}
        >
          <TabsList className="h-8 w-full">
            <TabsTrigger
              value="channel"
              className="text-xs"
              disabled={!mayEdit || !hasChannelBooks}
              title={
                hasChannelBooks
                  ? undefined
                  : "This channel has no books — add them in Channels → Books"
              }
            >
              From channel
            </TabsTrigger>
            <TabsTrigger value="manual" className="text-xs" disabled={!mayEdit}>
              Upload manually
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {mode === "channel" && channelBooks && (
        <div className="space-y-2">
          <Select
            value={pickedId}
            onValueChange={pickChannelBook}
            disabled={!mayEdit}
          >
            <SelectTrigger className="w-full" aria-label="Channel book">
              <SelectValue placeholder="Choose one of this channel's books" />
            </SelectTrigger>
            <SelectContent>
              {channelBooks.map(b => (
                <SelectItem key={b.id} value={String(b.id)}>
                  <span className="flex min-w-0 items-center gap-2">
                    {b.coverImageUrl ? (
                      <Thumb
                        src={b.coverImageUrl}
                        width={160}
                        alt=""
                        className="h-7 w-5 shrink-0 rounded-sm object-cover"
                      />
                    ) : (
                      <span className="h-7 w-5 shrink-0 rounded-sm bg-muted" />
                    )}
                    <span className="truncate">{b.title}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pickedBook && (
            <div className="flex gap-3 rounded-md border border-border p-2">
              {pickedBook.coverImageUrl ? (
                <Thumb
                  src={pickedBook.coverImageUrl}
                  width={160}
                  alt="Book cover"
                  className="h-20 w-14 shrink-0 rounded-sm object-cover"
                />
              ) : (
                <span className="flex h-20 w-14 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] text-muted-foreground">
                  No cover
                </span>
              )}
              <div className="min-w-0 flex-1 space-y-1 text-xs">
                <p className="font-medium leading-snug">{pickedBook.title}</p>
                <p
                  className="truncate text-muted-foreground"
                  title={pickedBook.shopUrl ?? undefined}
                >
                  {pickedBook.shopUrl || "No link set on this book"}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
      {mode === "manual" && (
        <div className="flex gap-3">
          <label
            className={`flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/40 ${
              mayEdit ? "cursor-pointer hover:bg-muted" : ""
            }`}
            title="Book cover"
          >
            {upload.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : cover ? (
              <img
                src={cover}
                alt="Book cover"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
                <ImagePlus className="h-5 w-5" />
                Cover
              </span>
            )}
            <input
              type="file"
              accept={ACCEPTED.join(",")}
              className="hidden"
              disabled={!mayEdit || upload.isPending}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (!ACCEPTED.includes(file.type))
                  return toast.error("Use a JPG, PNG, or WEBP image.");
                if (file.size > 10 * 1024 * 1024)
                  return toast.error("Image must be under 10 MB");
                const reader = new FileReader();
                reader.onload = () =>
                  upload.mutate({ dataUrl: reader.result as string });
                reader.readAsDataURL(file);
              }}
            />
          </label>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Title, as the narrator says it</Label>
              <Input
                value={title}
                disabled={!mayEdit}
                onChange={e => setTitle(e.target.value)}
                placeholder={`The book's ${language.name} title`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Link (the QR code opens it)</Label>
              <Input
                value={shopUrl}
                disabled={!mayEdit}
                onChange={e => setShopUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={
          !mode ||
          !mayEdit ||
          !changed ||
          !title.trim() ||
          (mode === "channel" && !pickedBook) ||
          save.isPending
        }
        onClick={() =>
          save.mutate({
            channelKey,
            language: language.code,
            title: title.trim(),
            coverImageUrl: cover,
            shopUrl: shopUrl.trim() || null,
          })
        }
      >
        {save.isPending && (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        )}
        Save book
      </Button>
    </div>
  );
}

/**
 * One language's script for one position — what the clip says, like the HeyGen test's script
 * box. Claude writes it ("Write with Claude", saved at once); a person may edit and Save it, and
 * Make clips speaks the saved words exactly. `{book}` is where the language's title goes.
 */
function ScriptBox({
  channelKey,
  language,
  position,
  saved,
  bookTitle,
  mayEdit,
}: {
  channelKey: string;
  language: DubLanguage;
  position: DubCtaPosition;
  saved: Script | undefined;
  bookTitle: string | null;
  mayEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [text, setText] = useState(saved?.text ?? "");
  // The saved script may arrive (or change, after Write with Claude) after the first render:
  // take it whenever nothing unsaved is in the box.
  const [base, setBase] = useState(saved?.text ?? "");
  useEffect(() => {
    const next = saved?.text ?? "";
    if (next === base) return;
    if (text === base) setText(next);
    setBase(next);
  }, [saved?.text, base, text]);
  const [confirmRewrite, setConfirmRewrite] = useState(false);

  const dirty = text !== (saved?.text ?? "");
  const error = text.trim() ? dubScriptError(text) : null;
  const length = dubScriptLength(text);
  const offAim =
    !!text.trim() &&
    (length.sec < DUB_SCRIPT_AIM_SEC.min ||
      length.sec > DUB_SCRIPT_AIM_SEC.max);

  const write = trpc.dubCta.writeScript.useMutation({
    onSuccess: async row => {
      setText(row.text);
      setBase(row.text);
      await utils.dubCta.list.invalidate({ channelKey });
      toast.success(
        `${language.name} ${DUB_POSITION_LABEL[position].toLowerCase()} script written`
      );
    },
    onError: err => toast.error(err.message),
  });
  const save = trpc.dubCta.saveScript.useMutation({
    onSuccess: async row => {
      setBase(row.text);
      await utils.dubCta.list.invalidate({ channelKey });
      toast.success(`${language.name} script saved`);
    },
    onError: err => toast.error(err.message),
  });
  const runWrite = () =>
    write.mutate({ channelKey, language: language.code, position });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Label
        className="text-sm font-medium"
        htmlFor={`script-${language.code}-${position}`}
      >
        {DUB_POSITION_LABEL[position]} script
      </Label>
      <Textarea
        id={`script-${language.code}-${position}`}
        value={text}
        disabled={!mayEdit || write.isPending}
        onChange={e => setText(e.target.value)}
        rows={5}
        placeholder={`Write with Claude, or type it in ${language.name}. Put ${DUB_BOOK_TOKEN} where the title is said.`}
        className="text-sm"
        aria-invalid={!!error}
      />
      <p
        className={`text-xs ${error ? "text-destructive" : offAim ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
      >
        {error ??
          (text.trim()
            ? `${length.count} ${length.unit} · about ${Math.round(length.sec)} s (aim for ${DUB_SCRIPT_AIM_SEC.min}–${DUB_SCRIPT_AIM_SEC.max} s) · ${DUB_BOOK_TOKEN} becomes ${bookTitle ? `"${bookTitle}"` : `the ${language.name} book's title`}`
            : "No script yet — Make clips writes one if you don't.")}
      </p>
      {text.trim() &&
        (dirty ? (
          <p className="text-xs text-muted-foreground">
            The English meaning updates when you save.
          </p>
        ) : (
          saved?.english && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">English:</span> {saved.english}
            </p>
          )
        ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!mayEdit || write.isPending || save.isPending}
          onClick={() =>
            dirty && text.trim() ? setConfirmRewrite(true) : runWrite()
          }
        >
          {write.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          {write.isPending
            ? "Writing…"
            : saved
              ? "Write again with Claude"
              : "Write with Claude"}
        </Button>
        <Button
          size="sm"
          disabled={
            !mayEdit ||
            !dirty ||
            !!error ||
            !text.trim() ||
            save.isPending ||
            write.isPending
          }
          onClick={() =>
            save.mutate({
              channelKey,
              language: language.code,
              position,
              text: text.trim(),
            })
          }
        >
          {save.isPending && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          )}
          Save script
        </Button>
        {dirty && saved && (
          <Button size="sm" variant="ghost" onClick={() => setText(saved.text)}>
            Undo changes
          </Button>
        )}
      </div>
      <AlertDialog open={confirmRewrite} onOpenChange={setConfirmRewrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Claude will write a new {language.name}{" "}
              {DUB_POSITION_LABEL[position].toLowerCase()} script and save it.
              What you typed in the box and haven&apos;t saved will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              onClick={() => {
                setConfirmRewrite(false);
                runWrite();
              }}
            >
              Write a new one
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The channel's SHARED B-ROLL: one set of three pictures for mid-video and one for end of video,
 * used under every language's clip of that position (`shared/dubCta.ts` `DubBrollSet`). Drawn by
 * the first Make clips of a position, or here; drawing again replaces the set.
 */
function SharedBroll({
  channelKey,
  rows,
  clips,
  mayEdit,
}: {
  channelKey: string;
  rows: Broll[];
  clips: Clip[];
  mayEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<DubCtaPosition | null>(null);
  const redraw = trpc.dubCta.redrawBroll.useMutation({
    onSuccess: async ({ started }) => {
      await utils.dubCta.list.invalidate({ channelKey });
      if (!started) toast.message("Those pictures are already being drawn.");
    },
    onError: err => toast.error(err.message),
  });
  const madeWith = (position: DubCtaPosition) =>
    clips.filter(c => c.position === position && c.videoUrl).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Shared b-roll</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        {DUB_CTA_POSITIONS.map(position => {
          const row = rows.find(r => r.position === position);
          const set = parseDubBroll(row?.pictures);
          const working = row?.state === "working";
          return (
            <div key={position} className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {DUB_POSITION_LABEL[position]}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!mayEdit || working || redraw.isPending}
                  onClick={() =>
                    set && madeWith(position)
                      ? setConfirm(position)
                      : redraw.mutate({ channelKey, position })
                  }
                >
                  {working ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {working ? "Drawing…" : set ? "Draw again" : "Draw pictures"}
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {DUB_BROLL_SLOTS.map((slot, i) => (
                  <figure key={slot.key} className="min-w-0 space-y-1">
                    {set ? (
                      <a
                        href={set[slot.key].url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Thumb
                          src={set[slot.key].url}
                          alt={set[slot.key].description}
                          className="aspect-video w-full rounded object-cover"
                        />
                      </a>
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center rounded border border-dashed text-[10px] text-muted-foreground">
                        {working ? "Drawing…" : "Not drawn yet"}
                      </div>
                    )}
                    <figcaption
                      className="truncate text-[11px] text-muted-foreground"
                      title={set?.[slot.key].description}
                    >
                      {i + 1} · {slot.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
              {!set && !working && (
                <p className="text-xs text-muted-foreground">
                  Drawn by the first Make clips, or now.
                </p>
              )}
              {(row?.state === "failed" || row?.state === "interrupted") && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {row.state === "interrupted"
                    ? "Stopped before it finished (the server restarted)."
                    : (row.error ?? "Failed.")}
                  {set ? " The pictures shown are still the ones in use." : ""}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
      <AlertDialog open={!!confirm} onOpenChange={o => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Draw new pictures?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm &&
                `The ${madeWith(confirm)} ${DUB_POSITION_LABEL[confirm].toLowerCase()} clip${madeWith(confirm) === 1 ? "" : "s"} already made keep the old pictures until you make them again, so every language matches.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                if (confirm) redraw.mutate({ channelKey, position: confirm });
                setConfirm(null);
              }}
            >
              Draw new pictures
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ClipSlot({
  position,
  clip,
  script: saved,
  broll,
  fileName,
}: {
  position: DubCtaPosition;
  clip: Clip | undefined;
  script: Script | undefined;
  broll: DubBrollSet | null;
  fileName: string;
}) {
  const script = useMemo<DubCtaScript | null>(() => {
    try {
      return clip?.script ? JSON.parse(clip.script) : null;
    } catch {
      return null;
    }
  }, [clip?.script]);
  const state = clip?.state;
  // A clip made before the script was last changed no longer says what the box says.
  const stale =
    state === "done" &&
    !!clip?.videoUrl &&
    !!saved &&
    !clipMatchesScript(script?.lines, saved.text, clip.bookTitle ?? "");
  // A clip built before the shared set, or from a set drawn again since, shows other pictures
  // than the rest of the languages.
  const otherPictures =
    state === "done" && !!clip?.videoUrl && !clipUsesBroll(script, broll);

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{DUB_POSITION_LABEL[position]}</p>
        {clip?.durationMs != null && clip.videoUrl && (
          <span className="text-xs text-muted-foreground">
            {(clip.durationMs / 1000).toFixed(0)} s
          </span>
        )}
      </div>
      {state === "working" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {clip?.phase ?? "Working"}…
          {clip?.videoUrl ? " (the clip below is the last one)" : ""}
        </p>
      )}
      {(state === "failed" || state === "interrupted") && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {state === "interrupted"
            ? "Stopped before it finished (the server restarted). Make it again."
            : (clip?.error ?? "Failed.")}
          {clip?.videoUrl ? " The clip below is the last one that worked." : ""}
        </p>
      )}
      {stale && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The script changed after this clip was made. Make clips again to use
          it.
        </p>
      )}
      {otherPictures && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This clip has different b-roll from the shared pictures. Make clips
          again so it matches the other languages.
        </p>
      )}
      {clip?.videoUrl ? (
        <>
          <video
            src={clip.videoUrl}
            controls
            preload="metadata"
            className="aspect-video w-full rounded bg-black"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadFile(clip.videoUrl!, "video", fileName)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download MP4
          </Button>
          {script && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                What it says
              </summary>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                {DUB_CTA_PARTS.map(p => (
                  <li key={p.key}>{script.lines[p.key]}</li>
                ))}
              </ol>
            </details>
          )}
        </>
      ) : (
        state !== "working" && (
          <p className="text-xs text-muted-foreground">Not made yet.</p>
        )
      )}
    </div>
  );
}
