import { BoardShell } from "@/components/board/BoardShell";
import { AuthGate } from "@/components/board/AuthGate";

export default function Home() {
  return (
    <AuthGate>
      <BoardShell />
    </AuthGate>
  );
}
