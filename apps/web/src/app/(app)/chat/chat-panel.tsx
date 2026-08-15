"use client";

import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { type AnswerResponse } from "@corpus-lens/shared/answer";
import { QUERY_MAX_LENGTH } from "@corpus-lens/shared/limits";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { AnswerStreamError, streamAnswer } from "@/lib/answer-stream";

import { AnswerText } from "./answer-text";
import { SourceCard } from "./source-card";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

const EXAMPLES = [
  "What is the maximum file size for an AppLovin playable, and how does it ship?",
  "How do I initialize the current Lumen SDK, and what happened to lumen.track?",
  "What QA issues were found in the December 2025 Merge Marina delivery?",
];

type Status = "idle" | "streaming" | "done" | "error";

export function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [streamedText, setStreamedText] = useState("");
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const [error, setError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [activeSourceIndex, setActiveSourceIndex] = useState<number | null>(null);

  // Held so a second submission cancels the first. Without it, two overlapping streams
  // interleave their tokens into the same state and produce nonsense.
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAsked(trimmed);
    setStatus("streaming");
    setStreamedText("");
    setResult(null);
    setError(null);
    setActiveSourceIndex(null);

    try {
      await streamAnswer(
        API_BASE_URL,
        { question: trimmed },
        {
          onToken: (token) => setStreamedText((current) => current + token),
          onResult: (answer) => setResult(answer),
        },
        controller.signal,
      );
      setStatus("done");
    } catch (caught) {
      // An abort is this component cancelling itself, not a failure to report.
      if (controller.signal.aborted) return;

      setStatus("error");
      setError(
        caught instanceof AnswerStreamError
          ? { message: caught.message, requestId: caught.requestId }
          : { message: "Could not reach the server.", requestId: null },
      );
    }
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void ask(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter submits, Shift+Enter inserts a newline — the convention every chat interface
    // uses, and the reason this is a textarea rather than an input.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(question);
    }
  }

  function scrollToSource(sourceIndex: number): void {
    setActiveSourceIndex(sourceIndex);
    document.getElementById(`source-${sourceIndex}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  const citedIndexes = new Set((result?.citations ?? []).map((citation) => citation.sourceIndex));

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          // The same bound the API enforces, from the same constant — so the field cannot
          // accept something the server will reject.
          maxLength={QUERY_MAX_LENGTH}
          placeholder="Ask a question about the corpus…"
          className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm text-ink placeholder:text-faint focus:border-accent"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-faint">
            Enter to send · Shift+Enter for a new line · {question.length}/{QUERY_MAX_LENGTH}
          </span>
          <Button type="submit" loading={status === "streaming"} disabled={question.trim() === ""}>
            Ask
          </Button>
        </div>
      </form>

      {status === "idle" ? (
        <Examples
          onPick={(text) => {
            setQuestion(text);
            void ask(text);
          }}
        />
      ) : null}

      {asked !== null ? (
        <Card>
          <CardHeader
            title={asked}
            description={result === null ? undefined : <Timings result={result} />}
          />
          <CardBody>
            <AnswerBody
              status={status}
              streamedText={streamedText}
              result={result}
              error={error}
              activeSourceIndex={activeSourceIndex}
              onCitationClick={scrollToSource}
            />
          </CardBody>
        </Card>
      ) : null}

      {result !== null && result.sources.length > 0 ? (
        <Card>
          <CardHeader
            title="Retrieved passages"
            description={`${result.sources.length} shown to the model, best first`}
          />
          <CardBody>
            <ul className="flex flex-col gap-2">
              {result.sources.map((passage, index) => (
                <SourceCard
                  key={passage.chunkId}
                  passage={passage}
                  index={index}
                  highlighted={activeSourceIndex === index}
                  cited={citedIndexes.has(index)}
                />
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The four states this view can be in, kept in one place so none of them is forgotten
 * (CLAUDE.md §7 requires loading, empty and error; abstention is a fourth that is specific
 * to this product and must not be rendered as either an answer or an error).
 */
function AnswerBody({
  status,
  streamedText,
  result,
  error,
  activeSourceIndex,
  onCitationClick,
}: {
  status: Status;
  streamedText: string;
  result: AnswerResponse | null;
  error: { message: string; requestId: string | null } | null;
  activeSourceIndex: number | null;
  onCitationClick: (sourceIndex: number) => void;
}) {
  if (status === "error" && error !== null) {
    return (
      <ErrorState title="Could not answer" message={error.message} requestId={error.requestId} />
    );
  }

  // Streaming, before the first token arrives. The server holds tokens back until it knows
  // the response is not a refusal, so a short silence here is expected rather than a stall.
  if (status === "streaming" && streamedText.length === 0) {
    return (
      <div className="flex flex-col gap-2" aria-live="polite" aria-label="Generating answer">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (status === "streaming") {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink" aria-live="polite">
        {streamedText}
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" />
      </p>
    );
  }

  if (result === null) return null;

  /**
   * Abstention as its own state, not a paragraph of hedging.
   *
   * `answered` is a boolean on the wire precisely so this branch exists (CLAUDE.md §6).
   * It is styled as information rather than as an error, because the system working
   * correctly and the corpus not containing an answer are the same event here.
   */
  if (!result.answered) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning-soft p-3">
        <p className="text-sm font-medium text-warning">Not in the corpus</p>
        <p className="mt-1 text-sm text-ink">{result.text}</p>
        <p className="mt-2 text-xs text-muted">
          {result.abstainReason === "NO_RELEVANT_CONTEXT"
            ? "Nothing retrieved scored highly enough to be worth answering from, so the model was not asked."
            : "Passages were retrieved, but the model judged that they do not contain the answer."}
        </p>
      </div>
    );
  }

  return (
    <AnswerText
      text={result.text}
      citations={result.citations}
      onCitationClick={onCitationClick}
      activeSourceIndex={activeSourceIndex}
    />
  );
}

function Timings({ result }: { result: AnswerResponse }) {
  const { embedMs, retrieveMs, generateMs, totalMs } = result.timings;
  return (
    <span className="font-mono text-[11px]">
      embed {embedMs}ms · retrieve {retrieveMs}ms · generate {generateMs ?? "—"}ms · total {totalMs}
      ms
    </span>
  );
}

function Examples({ onPick }: { onPick: (text: string) => void }) {
  return (
    <Card>
      <CardBody className="p-0">
        <EmptyState
          title="Nothing asked yet"
          description="Ask anything covered by the indexed documents. Try one of these:"
          action={
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => onPick(example)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  {example}
                </button>
              ))}
            </div>
          }
        />
      </CardBody>
    </Card>
  );
}
