import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, KeyRound, Plug, Settings } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ProviderKeys } from "@/components/admin/ProviderKeys";
import { LongformInstruction } from "@/components/admin/LongformInstruction";
import { LongformPacing } from "@/components/admin/LongformPacing";

/**
 * 69Labs provider card — the video/image/TTS lane. One provider row lives in
 * the DB; its key is entered here (stored encrypted) and it must be Active for
 * generation to run.
 */
function SixtyNineLabsCard() {
  const utils = trpc.useUtils();
  const { data: providers, isLoading } = trpc.provider.list.useQuery();
  const [apiKey, setApiKey] = useState("");

  const row = providers?.find(p => p.providerType === "sixtynine_labs");

  const saveMutation = trpc.provider.save.useMutation({
    onSuccess: () => {
      toast.success("69Labs provider saved");
      setApiKey("");
      utils.provider.list.invalidate();
      utils.provider.getStatus.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const testMutation = trpc.provider.testConnection.useMutation({
    onSuccess: res => {
      if (res.success) toast.success("69Labs connection OK");
      else toast.error(`Connection failed: ${res.message ?? "unknown error"}`);
      utils.provider.list.invalidate();
      utils.provider.getStatus.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const setActiveMutation = trpc.provider.setActive.useMutation({
    onSuccess: () => {
      toast.success("69Labs set as active provider");
      utils.provider.list.invalidate();
      utils.provider.getStatus.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" />
          69Labs (video · image · TTS)
          {row && (
            <Badge
              variant={row.isActive ? "default" : "secondary"}
              className="ml-2"
            >
              {row.isActive ? "Active" : "Inactive"}
            </Badge>
          )}
          {row && (
            <Badge
              variant={
                row.connectionStatus === "connected" ? "default" : "secondary"
              }
            >
              {row.connectionStatus}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">
                API key{" "}
                {row?.apiKeyMasked ? (
                  <span className="text-muted-foreground">
                    (current: {row.apiKeyMasked})
                  </span>
                ) : (
                  <span className="text-warning">(not set)</span>
                )}
              </Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="vk_..."
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  className="max-w-md"
                />
                <Button
                  size="sm"
                  disabled={!apiKey || saveMutation.isPending}
                  onClick={() =>
                    saveMutation.mutate({
                      id: row?.id,
                      providerType: "sixtynine_labs",
                      displayName: "69Labs",
                      apiKey,
                      isActive: true,
                    })
                  }
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
              </div>
            </div>
            {row && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate({ id: row.id })}
                >
                  {testMutation.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  Test connection
                </Button>
                {!row.isActive && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActiveMutation.isPending}
                    onClick={() => setActiveMutation.mutate({ id: row.id })}
                  >
                    Set active
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Settings}
        title="Admin"
        description="Provider keys and the directing instruction — set once, rarely touched. Per-channel settings live under Channels."
      />
      <Tabs defaultValue="keys" className="gap-4">
        <TabsList>
          <TabsTrigger value="keys">Provider keys</TabsTrigger>
          <TabsTrigger value="instruction">Longform instruction</TabsTrigger>
          <TabsTrigger value="pacing">Longform pacing</TabsTrigger>
        </TabsList>
        <TabsContent value="keys" className="space-y-4">
          <SixtyNineLabsCard />
          <ProviderKeys />
        </TabsContent>
        <TabsContent value="instruction">
          <LongformInstruction />
        </TabsContent>
        <TabsContent value="pacing">
          <LongformPacing />
        </TabsContent>
      </Tabs>
    </div>
  );
}
