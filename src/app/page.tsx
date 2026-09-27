import { BoardShell } from "@/components/board/BoardShell";
import { AuthGate } from "@/components/board/AuthGate";
import { BackgroundTasksProvider } from "@/contexts/BackgroundTasksContext";
import { EventOpenerProvider } from "@/components/board/calendar/EventOpener";
import { LiveProvider } from "@/components/board/live/LiveProvider";

// Les server actions appelées depuis cette page héritent de ce budget — une publication Instagram
// vidéo attend le traitement du Reel côté Meta jusqu'à ~50s (voir src/lib/social/graph.ts).
export const maxDuration = 60;

export default function Home() {
  return (
    <AuthGate>
      <BackgroundTasksProvider>
        <LiveProvider>
          <EventOpenerProvider>
            <BoardShell />
          </EventOpenerProvider>
        </LiveProvider>
      </BackgroundTasksProvider>
    </AuthGate>
  );
}
