import { type Metadata } from "next";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Chat · corpus-lens" };

/**
 * Placeholder. Step 11 replaces this with the question input, the streamed answer and the
 * citation chips; the shell, the session and the navigation around it are Step 10's work
 * and are already real.
 */
export default function ChatPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Ask the corpus</h1>
        <p className="mt-1 text-sm text-muted">
          Answers are built only from the indexed documents and cite the passages they came from.
        </p>
      </div>

      <Card>
        <CardHeader title="Chat" description="Arrives in the next step" />
        <CardBody className="p-0">
          <EmptyState
            title="Nothing asked yet"
            description="The question input and streamed answers land here in Step 11."
          />
        </CardBody>
      </Card>
    </div>
  );
}
