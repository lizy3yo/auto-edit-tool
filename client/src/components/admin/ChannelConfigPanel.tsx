import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Plus,
  Save,
  Settings,
  Trash2,
} from "lucide-react";

function ImageUploadField({
  label,
  helpText,
  value,
  onChange,
  fit,
  whiteBg,
  uploadLabel,
}: {
  label: string;
  helpText: string;
  value: string;
  onChange: (url: string) => void;
  fit: "contain" | "cover";
  whiteBg?: boolean;
  uploadLabel: string;
}) {
  const upload = trpc.styleReference.upload.useMutation({
    onSuccess: ({ url }) => {
      onChange(url);
      toast.success(`${label} uploaded`);
    },
    onError: err => toast.error(err.message),
  });
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <p className="text-[11px] text-muted-foreground mb-1">{helpText}</p>
      {value ? (
        <div className="flex items-center gap-3">
          <img
            src={value}
            alt={label}
            className={`h-20 w-20 rounded border border-border ${
              fit === "cover" ? "object-cover" : "object-contain"
            } ${whiteBg ? "bg-white" : ""}`}
          />
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => onChange("")}
          >
            Remove
          </Button>
        </div>
      ) : (
        <label className="inline-flex cursor-pointer items-center gap-2 h-8 px-3 rounded-md border border-dashed border-border bg-secondary/30 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50">
          {upload.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {upload.isPending ? "Uploading..." : uploadLabel}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (
                !["image/jpeg", "image/png", "image/webp"].includes(file.type)
              ) {
                toast.error("Use a JPG, PNG, or WEBP image.");
                return;
              }
              if (file.size > 10 * 1024 * 1024) {
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

export function ChannelConfigPanel() {
  const utils = trpc.useUtils();
  const {
    data: allChannels,
    isLoading,
    isError,
    error,
    refetch,
  } = trpc.channelConfig.listAllChannels.useQuery();
  const { data: configs } = trpc.channelConfig.list.useQuery();
  const upsertMutation = trpc.channelConfig.upsert.useMutation({
    onSuccess: () => {
      utils.channelConfig.list.invalidate();
      utils.channelConfig.listAllChannels.invalidate();
      toast.success("Channel configuration saved");
    },
    onError: err => toast.error(err.message),
  });
  const createMutation = trpc.channelConfig.create.useMutation({
    onSuccess: data => {
      utils.channelConfig.list.invalidate();
      utils.channelConfig.listAllChannels.invalidate();
      toast.success("Channel created");
      setCreateOpen(false);
      setEditForm({
        authorName: createForm.authorName,
        ctaQrImageUrl: createForm.ctaQrImageUrl,
        bookCoverImageUrl: createForm.bookCoverImageUrl,
        hostPhotoUrl: createForm.hostPhotoUrl,
        hostPhotoUrl2: createForm.hostPhotoUrl2,
        hostName: createForm.hostName,
        hostTitle: createForm.hostTitle,
        hostLocation: createForm.hostLocation,
        personaProfile: createForm.personaProfile,
        voiceId: createForm.voiceId,
        voiceName: createForm.voiceName,
        ttsModel: createForm.ttsModel || "eleven_multilingual_v2",
        ttsSpeed: createForm.ttsSpeed,
        ttsVolume: createForm.ttsVolume,
        defaultAngle: createForm.defaultAngle,
        defaultFormat: createForm.defaultFormat,
        defaultWordCount: createForm.defaultWordCount,
      });
      setEditingChannel(data.channelKey);
      setCreateForm({
        displayName: "",
        authorName: "",
        personaProfile: "",
        nicheSlug: "gardening",
        ctaQrImageUrl: "",
        bookCoverImageUrl: "",
        hostPhotoUrl: "",
        hostPhotoUrl2: "",
        hostName: "",
        hostTitle: "",
        hostLocation: "",
        voiceId: "",
        voiceName: "",
        ttsModel: "eleven_multilingual_v2",
        ttsSpeed: "",
        ttsVolume: "",
        defaultAngle: "",
        defaultFormat: "",
        defaultWordCount: "",
      });
    },
    onError: err => toast.error(err.message),
  });
  const deleteMutation = trpc.channelConfig.delete.useMutation({
    onSuccess: () => {
      utils.channelConfig.list.invalidate();
      utils.channelConfig.listAllChannels.invalidate();
      toast.success("Channel deleted");
      setDeleteChannel(null);
    },
    onError: err => toast.error(err.message),
  });

  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    authorName: string;
    ctaQrImageUrl: string;
    bookCoverImageUrl: string;
    hostPhotoUrl: string;
    hostPhotoUrl2: string;
    hostName: string;
    hostTitle: string;
    hostLocation: string;
    personaProfile: string;
    voiceId: string;
    voiceName: string;
    ttsModel: string;
    ttsSpeed: string;
    ttsVolume: string;
    defaultAngle: string;
    defaultFormat: string;
    defaultWordCount: string;
  }>({
    authorName: "",
    ctaQrImageUrl: "",
    bookCoverImageUrl: "",
    hostPhotoUrl: "",
    hostPhotoUrl2: "",
    hostName: "",
    hostTitle: "",
    hostLocation: "",
    personaProfile: "",
    voiceId: "",
    voiceName: "",
    ttsModel: "eleven_multilingual_v2",
    ttsSpeed: "",
    ttsVolume: "",
    defaultAngle: "",
    defaultFormat: "",
    defaultWordCount: "",
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    displayName: "",
    authorName: "",
    personaProfile: "",
    nicheSlug: "gardening",
    ctaQrImageUrl: "",
    bookCoverImageUrl: "",
    hostPhotoUrl: "",
    hostPhotoUrl2: "",
    hostName: "",
    hostTitle: "",
    hostLocation: "",
    voiceId: "",
    voiceName: "",
    ttsModel: "eleven_multilingual_v2",
    ttsSpeed: "",
    ttsVolume: "",
    defaultAngle: "",
    defaultFormat: "",
    defaultWordCount: "",
  });
  const [deleteChannel, setDeleteChannel] = useState<{
    key: string;
    name: string;
  } | null>(null);

  const handleEdit = (channelKey: string) => {
    const config = configs?.find((c: any) => c.channelKey === channelKey);
    setEditForm({
      authorName: config?.authorName || "",
      ctaQrImageUrl: config?.ctaQrImageUrl || "",
      bookCoverImageUrl: config?.bookCoverImageUrl || "",
      hostPhotoUrl: config?.hostPhotoUrl || "",
      hostPhotoUrl2: config?.hostPhotoUrl2 || "",
      hostName: config?.hostName || "",
      hostTitle: config?.hostTitle || "",
      hostLocation: config?.hostLocation || "",
      personaProfile: config?.personaProfile || "",
      voiceId: config?.voiceId || "",
      voiceName: config?.voiceName || "",
      ttsModel: config?.ttsModel || "eleven_multilingual_v2",
      ttsSpeed: config?.ttsSpeed || "",
      ttsVolume: config?.ttsVolume || "",
      defaultAngle: config?.defaultAngle || "",
      defaultFormat: config?.defaultFormat || "",
      defaultWordCount: config?.defaultWordCount
        ? String(config.defaultWordCount)
        : "",
    });
    setEditingChannel(channelKey);
  };

  const handleSave = () => {
    if (!editingChannel) return;
    upsertMutation.mutate({
      channelKey: editingChannel,
      authorName: editForm.authorName || undefined,
      ctaQrImageUrl: editForm.ctaQrImageUrl || undefined,
      bookCoverImageUrl: editForm.bookCoverImageUrl || undefined,
      hostPhotoUrl: editForm.hostPhotoUrl || undefined,
      hostPhotoUrl2: editForm.hostPhotoUrl2 || undefined,
      hostName: editForm.hostName || undefined,
      hostTitle: editForm.hostTitle || undefined,
      hostLocation: editForm.hostLocation || undefined,
      personaProfile: editForm.personaProfile || undefined,
      voiceId: editForm.voiceId || undefined,
      voiceName: editForm.voiceName || undefined,
      ttsModel: editForm.ttsModel || undefined,
      ttsSpeed: editForm.ttsSpeed || undefined,
      ttsVolume: editForm.ttsVolume || undefined,
      defaultAngle: editForm.defaultAngle || undefined,
      defaultFormat: editForm.defaultFormat || undefined,
      defaultWordCount: editForm.defaultWordCount
        ? parseInt(editForm.defaultWordCount)
        : undefined,
    });
    setEditingChannel(null);
  };

  const handleCreate = () => {
    if (
      !createForm.displayName.trim() ||
      !createForm.authorName.trim() ||
      !createForm.personaProfile.trim() ||
      !createForm.ctaQrImageUrl ||
      !createForm.bookCoverImageUrl ||
      !createForm.hostPhotoUrl
    )
      return;
    createMutation.mutate({
      displayName: createForm.displayName.trim(),
      authorName: createForm.authorName.trim(),
      personaProfile: createForm.personaProfile.trim(),
      nicheSlug: createForm.nicheSlug,
      ctaQrImageUrl: createForm.ctaQrImageUrl,
      bookCoverImageUrl: createForm.bookCoverImageUrl,
      hostPhotoUrl: createForm.hostPhotoUrl,
      hostPhotoUrl2: createForm.hostPhotoUrl2 || undefined,
      hostName: createForm.hostName || undefined,
      hostTitle: createForm.hostTitle || undefined,
      hostLocation: createForm.hostLocation || undefined,
      voiceId: createForm.voiceId || undefined,
      voiceName: createForm.voiceName || undefined,
      ttsModel: createForm.ttsModel || undefined,
      ttsSpeed: createForm.ttsSpeed || undefined,
      ttsVolume: createForm.ttsVolume || undefined,
      defaultAngle: createForm.defaultAngle || undefined,
      defaultFormat: createForm.defaultFormat || undefined,
      defaultWordCount: createForm.defaultWordCount
        ? parseInt(createForm.defaultWordCount)
        : undefined,
    });
  };

  const configMap: Record<string, any> = {};
  configs?.forEach((c: any) => {
    configMap[c.channelKey] = c;
  });

  const editFormSection = (
    <div className="mt-4 border-t border-border pt-4 space-y-4">
      {/* Author Name */}
      <div>
        <Label className="text-xs">Author Name / Pen Name</Label>
        <p className="text-[11px] text-muted-foreground mb-1">
          Name that appears on ebook covers.
        </p>
        <Input
          value={editForm.authorName}
          onChange={e =>
            setEditForm(f => ({ ...f, authorName: e.target.value }))
          }
          placeholder="e.g., James R. Hartley"
          className="text-xs h-8"
        />
      </div>
      <ImageUploadField
        label="CTA QR Code"
        helpText="Overlaid in the corner during call-to-action scenes of long-form videos (e.g. your book/product site). PNG/JPG, under 10 MB."
        value={editForm.ctaQrImageUrl}
        onChange={url => setEditForm(f => ({ ...f, ctaQrImageUrl: url }))}
        fit="contain"
        whiteBg
        uploadLabel="Upload QR image"
      />
      <ImageUploadField
        label="Book Cover"
        helpText="Revealed full-frame (large, white glow) the first time the book is named in each call-to-action of long-form videos. PNG/JPG, under 10 MB."
        value={editForm.bookCoverImageUrl}
        onChange={url => setEditForm(f => ({ ...f, bookCoverImageUrl: url }))}
        fit="contain"
        whiteBg
        uploadLabel="Upload book cover"
      />
      <ImageUploadField
        label="Host Photo"
        helpText="Front-facing photo of the host. Used as the on-camera face for talking scenes and lip-sync in long-form videos. PNG/JPG, under 10 MB."
        value={editForm.hostPhotoUrl}
        onChange={url => setEditForm(f => ({ ...f, hostPhotoUrl: url }))}
        fit="cover"
        uploadLabel="Upload host photo"
      />
      <ImageUploadField
        label="Host Photo — Alt Angle (optional)"
        helpText="Optional second host photo from a DIFFERENT camera angle. When set, host scenes alternate between the two angles so consecutive host cuts don't look identical (and two host scenes may sit back-to-back). PNG/JPG, under 10 MB."
        value={editForm.hostPhotoUrl2}
        onChange={url => setEditForm(f => ({ ...f, hostPhotoUrl2: url }))}
        fit="cover"
        uploadLabel="Upload alt host photo"
      />
      {/* On-screen host identity (lower third) */}
      <div>
        <Label className="text-xs">On-Screen Host Identity</Label>
        <p className="text-[11px] text-muted-foreground mb-1">
          Shown as a lower-third card on the first host shot of each long-form
          video, then fades out. Leave blank for no card.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={editForm.hostName}
            onChange={e =>
              setEditForm(f => ({ ...f, hostName: e.target.value }))
            }
            placeholder="Steve Calloway"
            className="text-xs h-8"
          />
          <Input
            value={editForm.hostTitle}
            onChange={e =>
              setEditForm(f => ({ ...f, hostTitle: e.target.value }))
            }
            placeholder="Gardener"
            className="text-xs h-8"
          />
          <Input
            value={editForm.hostLocation}
            onChange={e =>
              setEditForm(f => ({ ...f, hostLocation: e.target.value }))
            }
            placeholder="Fresno, CA"
            className="text-xs h-8"
          />
        </div>
      </div>
      {/* Persona Profile */}
      <div>
        <Label className="text-xs">Persona Profile</Label>
        <p className="text-[11px] text-muted-foreground mb-1">
          Describe this channel's voice, personality, and audience. Used to
          guide AI script generation.
        </p>
        <Textarea
          value={editForm.personaProfile}
          onChange={e =>
            setEditForm(f => ({ ...f, personaProfile: e.target.value }))
          }
          placeholder="e.g., Jane is a seasoned Midwest gardener in her 50s who speaks plainly..."
          className="min-h-[100px] text-xs"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Voice settings */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
            Voice Settings
          </h4>
          <div>
            <Label className="text-xs">Voice ID</Label>
            <Input
              value={editForm.voiceId}
              onChange={e =>
                setEditForm(f => ({ ...f, voiceId: e.target.value }))
              }
              placeholder="e.g., wAGzRVkxKEs8La0lmdrE"
              className="mt-1 text-xs h-8"
            />
          </div>
          <div>
            <Label className="text-xs">Voice Name</Label>
            <Input
              value={editForm.voiceName}
              onChange={e =>
                setEditForm(f => ({ ...f, voiceName: e.target.value }))
              }
              placeholder="e.g., Sully - Mature, Deep and Intriguing"
              className="mt-1 text-xs h-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">TTS Model</Label>
              <Select
                value={editForm.ttsModel}
                onValueChange={v => setEditForm(f => ({ ...f, ttsModel: v }))}
              >
                <SelectTrigger className="mt-1 text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eleven_multilingual_v2">
                    Multilingual v2
                  </SelectItem>
                  <SelectItem value="eleven_turbo_v2_5">Turbo v2.5</SelectItem>
                  <SelectItem value="eleven_monolingual_v1">
                    Monolingual v1
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Speed</Label>
              <Input
                value={editForm.ttsSpeed}
                onChange={e =>
                  setEditForm(f => ({ ...f, ttsSpeed: e.target.value }))
                }
                placeholder="1.0"
                className="mt-1 text-xs h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Volume</Label>
              <Input
                value={editForm.ttsVolume}
                onChange={e =>
                  setEditForm(f => ({ ...f, ttsVolume: e.target.value }))
                }
                placeholder="1.0"
                className="mt-1 text-xs h-8"
              />
            </div>
          </div>
        </div>
        {/* Defaults */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
            Defaults
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Default Angle</Label>
              <Select
                value={editForm.defaultAngle || "none"}
                onValueChange={v =>
                  setEditForm(f => ({
                    ...f,
                    defaultAngle: v === "none" ? "" : v,
                  }))
                }
              >
                <SelectTrigger className="mt-1 text-xs h-8">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="Classical">Classical</SelectItem>
                  <SelectItem value="Amish">Amish</SelectItem>
                  <SelectItem value="Forbidden">Forbidden</SelectItem>
                  <SelectItem value="Medieval">Medieval</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Default Format</Label>
              <Select
                value={editForm.defaultFormat || "none"}
                onValueChange={v =>
                  setEditForm(f => ({
                    ...f,
                    defaultFormat: v === "none" ? "" : v,
                  }))
                }
              >
                <SelectTrigger className="mt-1 text-xs h-8">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="How-To">How-To</SelectItem>
                  <SelectItem value="Listicle">Listicle</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Word Count</Label>
              <Input
                value={editForm.defaultWordCount}
                onChange={e =>
                  setEditForm(f => ({ ...f, defaultWordCount: e.target.value }))
                }
                placeholder="3500"
                type="number"
                className="mt-1 text-xs h-8"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={upsertMutation.isPending}
          className="gap-1.5"
        >
          {upsertMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save Configuration
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Channel Configurations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Settings className="h-5 w-5" />
            Channel Configurations
          </CardTitle>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New Channel
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-destructive">
                Failed to load channels: {error?.message ?? "unknown error"}
              </p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {allChannels?.map(channel => {
                const config = configMap[channel.key];
                const isEditing = editingChannel === channel.key;
                return (
                  <div
                    key={channel.key}
                    className="rounded-lg border border-border bg-secondary/20 p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold">
                            {channel.name}
                          </h3>
                          {channel.isDynamic && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                              custom
                            </span>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div className="flex items-center gap-1.5">
                            <Mic className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">
                              Voice:
                            </span>
                            <span
                              className={
                                config?.voiceName
                                  ? "text-foreground"
                                  : "text-muted-foreground/50"
                              }
                            >
                              {config?.voiceName || "Not set"}
                            </span>
                            {config?.ttsSpeed && (
                              <span className="text-muted-foreground ml-1">
                                ({config.ttsSpeed}x)
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">
                              Defaults:
                            </span>
                            <span
                              className={
                                config?.defaultAngle
                                  ? "text-foreground"
                                  : "text-muted-foreground/50"
                              }
                            >
                              {config?.defaultAngle && config?.defaultFormat
                                ? `${config.defaultAngle} ${config.defaultFormat}${config.defaultWordCount ? ` (${config.defaultWordCount}w)` : ""}`
                                : "Not set"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="ml-4 flex items-center gap-2 shrink-0">
                        {channel.isDynamic && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setDeleteChannel({
                                key: channel.key,
                                name: channel.name,
                              })
                            }
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            isEditing
                              ? setEditingChannel(null)
                              : handleEdit(channel.key)
                          }
                        >
                          <Settings className="h-3.5 w-3.5" />
                          {isEditing ? "Cancel" : "Edit"}
                        </Button>
                      </div>
                    </div>
                    {isEditing && editFormSection}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Channel Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Identity */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                Channel Identity
              </h4>
              <div>
                <Label className="text-xs">
                  Display Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={createForm.displayName}
                  onChange={e =>
                    setCreateForm(f => ({ ...f, displayName: e.target.value }))
                  }
                  placeholder="e.g., Midwest Garden Pro"
                  className="mt-1 text-sm"
                />
                {createForm.displayName.trim() && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Key:{" "}
                    <code className="font-mono">
                      {createForm.displayName
                        .toLowerCase()
                        .replace(/[^a-z0-9\s]/g, "")
                        .trim()
                        .replace(/\s+/g, "_")}
                    </code>
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">
                  Author Name / Pen Name{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={createForm.authorName}
                  onChange={e =>
                    setCreateForm(f => ({ ...f, authorName: e.target.value }))
                  }
                  placeholder="e.g., James R. Hartley"
                  className="mt-1 text-sm"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Name that appears on ebook covers.
                </p>
              </div>
              <div>
                <Label className="text-xs">
                  Persona Profile <span className="text-destructive">*</span>
                </Label>
                <p className="text-[11px] text-muted-foreground mb-1">
                  Describe this channel's voice, personality, and audience. Used
                  to guide AI script generation.
                </p>
                <Textarea
                  value={createForm.personaProfile}
                  onChange={e =>
                    setCreateForm(f => ({
                      ...f,
                      personaProfile: e.target.value,
                    }))
                  }
                  placeholder="e.g., Jane is a seasoned Midwest gardener in her 50s who speaks plainly and focuses on cold-climate growing techniques..."
                  className="min-h-[120px] text-sm"
                />
              </div>
            </div>

            {/* Assets */}
            <div className="space-y-4 border-t border-border pt-4">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                Assets (required)
              </h4>
              <ImageUploadField
                label="CTA QR Code"
                helpText="Overlaid in the corner during call-to-action scenes of long-form videos (e.g. your book/product site). PNG/JPG, under 10 MB."
                value={createForm.ctaQrImageUrl}
                onChange={url =>
                  setCreateForm(f => ({ ...f, ctaQrImageUrl: url }))
                }
                fit="contain"
                whiteBg
                uploadLabel="Upload QR image"
              />
              <ImageUploadField
                label="Book Cover"
                helpText="Revealed full-frame (large, white glow) the first time the book is named in each call-to-action of long-form videos. PNG/JPG, under 10 MB."
                value={createForm.bookCoverImageUrl}
                onChange={url =>
                  setCreateForm(f => ({ ...f, bookCoverImageUrl: url }))
                }
                fit="contain"
                whiteBg
                uploadLabel="Upload book cover"
              />
              <ImageUploadField
                label="Host Photo"
                helpText="Front-facing photo of the host. Used as the on-camera face for talking scenes and lip-sync in long-form videos. PNG/JPG, under 10 MB."
                value={createForm.hostPhotoUrl}
                onChange={url =>
                  setCreateForm(f => ({ ...f, hostPhotoUrl: url }))
                }
                fit="cover"
                uploadLabel="Upload host photo"
              />
              <ImageUploadField
                label="Host Photo — Alt Angle (optional)"
                helpText="Optional second host photo from a DIFFERENT camera angle. When set, host scenes alternate between the two angles so consecutive host cuts don't look identical. PNG/JPG, under 10 MB."
                value={createForm.hostPhotoUrl2}
                onChange={url =>
                  setCreateForm(f => ({ ...f, hostPhotoUrl2: url }))
                }
                fit="cover"
                uploadLabel="Upload alt host photo"
              />
              <div>
                <Label className="text-xs">
                  On-Screen Host Identity (optional)
                </Label>
                <p className="text-[11px] text-muted-foreground mb-1">
                  Lower-third card shown on the first host shot of each
                  long-form video.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Input
                    value={createForm.hostName}
                    onChange={e =>
                      setCreateForm(f => ({ ...f, hostName: e.target.value }))
                    }
                    placeholder="Steve Calloway"
                    className="text-xs h-8"
                  />
                  <Input
                    value={createForm.hostTitle}
                    onChange={e =>
                      setCreateForm(f => ({ ...f, hostTitle: e.target.value }))
                    }
                    placeholder="Gardener"
                    className="text-xs h-8"
                  />
                  <Input
                    value={createForm.hostLocation}
                    onChange={e =>
                      setCreateForm(f => ({
                        ...f,
                        hostLocation: e.target.value,
                      }))
                    }
                    placeholder="Fresno, CA"
                    className="text-xs h-8"
                  />
                </div>
              </div>
            </div>

            {/* Operational Settings */}
            <div className="space-y-4 border-t border-border pt-4">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                Operational Settings (optional)
              </h4>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Voice ID</Label>
                    <Input
                      value={createForm.voiceId}
                      onChange={e =>
                        setCreateForm(f => ({ ...f, voiceId: e.target.value }))
                      }
                      placeholder="ElevenLabs voice ID"
                      className="mt-1 text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Voice Name</Label>
                    <Input
                      value={createForm.voiceName}
                      onChange={e =>
                        setCreateForm(f => ({
                          ...f,
                          voiceName: e.target.value,
                        }))
                      }
                      placeholder="Display name for voice"
                      className="mt-1 text-xs h-8"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">TTS Model</Label>
                    <Select
                      value={createForm.ttsModel}
                      onValueChange={v =>
                        setCreateForm(f => ({ ...f, ttsModel: v }))
                      }
                    >
                      <SelectTrigger className="mt-1 text-xs h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eleven_multilingual_v2">
                          Multilingual v2
                        </SelectItem>
                        <SelectItem value="eleven_turbo_v2_5">
                          Turbo v2.5
                        </SelectItem>
                        <SelectItem value="eleven_monolingual_v1">
                          Monolingual v1
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">TTS Speed</Label>
                    <Input
                      value={createForm.ttsSpeed}
                      onChange={e =>
                        setCreateForm(f => ({ ...f, ttsSpeed: e.target.value }))
                      }
                      placeholder="1.0"
                      className="mt-1 text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">TTS Volume</Label>
                    <Input
                      value={createForm.ttsVolume}
                      onChange={e =>
                        setCreateForm(f => ({
                          ...f,
                          ttsVolume: e.target.value,
                        }))
                      }
                      placeholder="1.0"
                      className="mt-1 text-xs h-8"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Default Angle</Label>
                    <Select
                      value={createForm.defaultAngle || "none"}
                      onValueChange={v =>
                        setCreateForm(f => ({
                          ...f,
                          defaultAngle: v === "none" ? "" : v,
                        }))
                      }
                    >
                      <SelectTrigger className="mt-1 text-xs h-8">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="Classical">Classical</SelectItem>
                        <SelectItem value="Amish">Amish</SelectItem>
                        <SelectItem value="Forbidden">Forbidden</SelectItem>
                        <SelectItem value="Medieval">Medieval</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Default Format</Label>
                    <Select
                      value={createForm.defaultFormat || "none"}
                      onValueChange={v =>
                        setCreateForm(f => ({
                          ...f,
                          defaultFormat: v === "none" ? "" : v,
                        }))
                      }
                    >
                      <SelectTrigger className="mt-1 text-xs h-8">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="How-To">How-To</SelectItem>
                        <SelectItem value="Listicle">Listicle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Word Count</Label>
                    <Input
                      value={createForm.defaultWordCount}
                      onChange={e =>
                        setCreateForm(f => ({
                          ...f,
                          defaultWordCount: e.target.value,
                        }))
                      }
                      placeholder="3500"
                      type="number"
                      className="mt-1 text-xs h-8"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                createMutation.isPending ||
                !createForm.displayName.trim() ||
                !createForm.authorName.trim() ||
                !createForm.personaProfile.trim() ||
                !createForm.ctaQrImageUrl ||
                !createForm.bookCoverImageUrl ||
                !createForm.hostPhotoUrl
              }
              className="gap-1.5"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create Channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={deleteChannel !== null}
        onOpenChange={open => {
          if (!open) setDeleteChannel(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteChannel?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the channel and all its
              configuration. Jobs that referenced this channel will retain their
              data but the channel will no longer appear in dropdowns.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteChannel &&
                deleteMutation.mutate({ channelKey: deleteChannel.key })
              }
              disabled={deleteMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
