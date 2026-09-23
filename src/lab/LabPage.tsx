// /lab: speech layer test bench for Hassan (SPEC 6, "Lab page").
// English for the dev controls; the mic check and banners are the Spanish
// components Julio will see.

import { useEffect } from "react";
import { useSpeech } from "../app/speech";
import { BrowserBanner } from "../components/BrowserBanner";
import { MetricsPanel } from "../components/MetricsPanel";
import { MicCheck } from "../components/MicCheck";
import { RecognitionBanner } from "../components/RecognitionBanner";
import { ConversationTest } from "./ConversationTest";
import { DuckingTest } from "./DuckingTest";
import { MonologueTest } from "./MonologueTest";
import { Button, Card, EventLog, MeterRow, SettingsPanel, StatusBar, TranscriptPanel, VoicePanel } from "./panels";

export default function LabPage() {
  const speech = useSpeech();

  useEffect(() => {
    void speech.init();
  }, [speech]);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Speech lab</h1>
        <span className="text-sm text-slate-500">Shift+D: debug overlay</span>
      </header>

      <BrowserBanner />
      <RecognitionBanner speech={speech} />

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          {speech.started ? (
            <Button onClick={() => speech.stop()}>Stop mic</Button>
          ) : (
            <Button primary onClick={() => void speech.start()}>
              Start mic
            </Button>
          )}
          <StatusBar speech={speech} />
        </div>
        <MeterRow speech={speech} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <MicCheck speech={speech} />
        <SettingsPanel speech={speech} />
      </div>

      <VoicePanel speech={speech} />
      <TranscriptPanel speech={speech} />
      <ConversationTest speech={speech} />
      <MonologueTest speech={speech} />
      <DuckingTest speech={speech} />

      <Card title="Numbers" hint="Same as the Shift+D overlay. 'Copy report' gives you text to paste into the checkpoint result.">
        <MetricsPanel metrics={speech.metrics} />
      </Card>
      <Card title="Event log">
        <EventLog speech={speech} />
      </Card>
    </main>
  );
}
