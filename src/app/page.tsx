import { BoardShell } from "@/components/board/BoardShell";
import { AuthGate } from "@/components/board/AuthGate";
import { BackgroundTasksProvider } from "@/contexts/BackgroundTasksContext";
import { EventOpenerProvider } from "@/components/board/calendar/EventOpener";
import { LiveProvider } from "@/components/board/live/LiveProvider";
import { TeamCardOpenerHost, TeamCardOpenerProvider } from "@/components/board/team/TeamCardOpener";

// Les server actions appelées depuis cette page héritent de ce budget. Une publication vidéo cumule
// extraction de la couverture (≤ 25 s), envoi Facebook (Meta télécharge la vidéo avant de répondre)
// et attente du Reel Instagram : 60 s ne suffisaient pas (coupure du 20/11, doublons Facebook).
export const maxDuration = 300;

export default function Home() {
  return (
    <AuthGate>
      <BackgroundTasksProvider>
        <LiveProvider>
          <TeamCardOpenerProvider>
            <EventOpenerProvider>
              <BoardShell />
              <TeamCardOpenerHost />
            </EventOpenerProvider>
          </TeamCardOpenerProvider>
        </LiveProvider>
      </BackgroundTasksProvider>
    </AuthGate>
  );
}
