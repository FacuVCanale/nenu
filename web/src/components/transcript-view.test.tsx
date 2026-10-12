import { QuestionLiveContext, QuestionReplyContext } from "./transcript-question";
import { FileMediaContext } from "@/lib/file-preview-context";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/setup";

import { TranscriptView } from "./transcript-view";
import { FilePreviewProvider } from "./file-preview-provider";
import type { TranscriptEntry } from "@/lib/types";

// TranscriptView renders the agent's own conversation log — the only history a Claude pane can have
// (its terminal runs on the alternate screen, which keeps no scrollback). The load-bearing
// behaviours: tool output stays collapsed so prose isn't buried, every string renders as TEXT (the
// same XSS boundary as the mirror), and a compaction summary is visibly not a human turn.

const turn = (over: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
  uuid: "u1",
  ts: "2026-07-25T06:22:21.253Z",
  role: "user",
  parts: [{ kind: "text", text: "hello" }],
  ...over,
});

async function openToolGroup() {
  const work = screen.getByRole("button", { name: /^Work log/ });
  if (work.getAttribute("aria-expanded") === "false") await userEvent.click(work);
  await userEvent.click(screen.getByRole("button", { name: /^1 tool call/ }));
}

describe("TranscriptView", () => {
  it("renders your turn as a bubble and the agent's as plain text, with no speaker labels", () => {
    render(
      <TranscriptView
        entries={[
          turn({ uuid: "u1", role: "user", parts: [{ kind: "text", text: "what changed?" }] }),
          turn({
            uuid: "a1",
            role: "assistant",
            parts: [{ kind: "text", text: "One commit." }],
          }),
        ]}
      />,
    );
    expect(screen.getByText("what changed?").closest("[data-speaker]")).toHaveAttribute("data-speaker", "user");
    expect(screen.getByText("One commit.").closest("[data-speaker]")).toHaveAttribute("data-speaker", "assistant");
    expect(screen.queryByText("You")).not.toBeInTheDocument();
    expect(screen.queryByText("claude")).not.toBeInTheDocument();
  });

  it("shows a tool call's summary but keeps its output collapsed until tapped", async () => {
    render(
      <TranscriptView
        entries={[
          turn({
            role: "assistant",
            parts: [
              {
                kind: "tool",
                name: "Bash",
                summary: "git log --oneline",
                result: { text: "abc1234 the commit body" },
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.queryByText("git log --oneline")).not.toBeInTheDocument();
    await openToolGroup();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("git log --oneline")).toBeInTheDocument();
    // Collapsed by default — a real thread is mostly tool traffic, and expanding it all buries the prose.
    expect(screen.queryByText(/abc1234 the commit body/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Bash git log --oneline", expanded: false }));
    expect(screen.getByText(/abc1234 the commit body/)).toBeInTheDocument();
  });

  it("a historical tool with missing output reports unknown rather than pretending it is still running", async () => {
    render(
      <TranscriptView
        entries={[
          turn({
            role: "assistant",
            parts: [{ kind: "tool", name: "Read", summary: "/a.ts" }],
          }),
        ]}
      />,
    );
    await openToolGroup();
    const tool = screen.getByRole("button", { name: "Read /a.ts No output recorded" });
    expect(tool).toBeEnabled();
    expect(screen.queryByText("Running…")).not.toBeInTheDocument();
    await userEvent.click(tool);
    expect(screen.getAllByText("No output recorded")).toHaveLength(2);
  });

  it("flags truncated output rather than silently dropping the tail", async () => {
    render(
      <TranscriptView
        entries={[
          turn({
            role: "assistant",
            parts: [
              {
                kind: "tool",
                name: "Read",
                summary: "/big",
                result: { text: "start of output", truncated: true },
              },
            ],
          }),
        ]}
      />,
    );
    await openToolGroup();
    await userEvent.click(screen.getByRole("button", { name: "Read /big Truncated", expanded: false }));
    expect(screen.getByText(/output truncated/)).toBeInTheDocument();
  });

  it("marks a compaction summary as one folded line, not as something a human said", async () => {
    render(
      <TranscriptView
        entries={[turn({ role: "summary", parts: [{ kind: "text", text: "…prior context…" }] })]}
      />,
    );
    expect(screen.queryByText("You")).not.toBeInTheDocument();
    expect(screen.queryByText("…prior context…")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Context compacted", expanded: false }));
    expect(screen.getByText("…prior context…")).toBeInTheDocument();
  });

  // Markdown introduced ONE new way for log content to reach the browser: an <a href>. A hostile
  // scheme must never survive as a real link — the parser refuses it and the text stays literal.
  it("never turns an unsafe link target into an anchor", () => {
    const { container } = render(
      <TranscriptView
        entries={[
          turn({ parts: [{ kind: "text", text: "[tap me](javascript:alert(1))" }] }),
        ]}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/tap me/)).toBeInTheDocument();
  });

  it("a safe link renders as an anchor that can't reach back into the app", () => {
    const { container } = render(
      <TranscriptView
        entries={[turn({ parts: [{ kind: "text", text: "[docs](https://example.com)" }] })]}
      />,
    );
    const a = container.querySelector("a");
    expect(a).toHaveAttribute("href", "https://example.com");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders log text as TEXT, never as markup (the XSS boundary)", () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <TranscriptView entries={[turn({ parts: [{ kind: "text", text: hostile }] })]} />,
    );
    // The characters survive verbatim…
    expect(screen.getByText(hostile)).toBeInTheDocument();
    // …and no element was ever constructed from them.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders prose as formatted Markdown", () => {
    const { container } = render(
      <TranscriptView
        entries={[
          turn({ parts: [{ kind: "text", text: "## Heading\n\n**bold** and `code`" }] }),
        ]}
      />,
    );
    // The syntax is consumed into structure rather than shown literally…
    expect(screen.queryByText(/## Heading/)).not.toBeInTheDocument();
    expect(screen.getByText("Heading")).toBeInTheDocument();
    // …and the emphasis/code become real elements.
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("code")).toHaveTextContent("code");
  });

  it("tool output is NOT markdown-parsed — it's command output, kept verbatim", async () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <TranscriptView
        entries={[
          turn({
            role: "assistant",
            parts: [
              {
                kind: "tool",
                name: "Bash",
                summary: "cat notes.md",
                result: { text: `## literal heading\n**literal stars**\n${hostile}` },
              },
            ],
          }),
        ]}
      />,
    );
    await openToolGroup();
    await userEvent.click(screen.getByRole("button", { name: "Bash cat notes.md", expanded: false }));
    expect(screen.getByText(/## literal heading/)).toBeInTheDocument();
    expect(container.textContent).toContain(hostile);
    expect(container.querySelector("img,script,strong,h2")).toBeNull();
  });

  it("groups turns under a day divider, once per day", () => {
    render(
      <TranscriptView
        entries={[
          turn({ uuid: "a", ts: "2026-07-25T06:00:00.000Z" }),
          turn({ uuid: "b", ts: "2026-07-25T07:00:00.000Z" }),
          turn({ uuid: "c", ts: "2026-07-26T08:00:00.000Z" }),
        ]}
      />,
    );
    const day25 = new Date("2026-07-25T06:00:00.000Z").toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
    const day26 = new Date("2026-07-26T08:00:00.000Z").toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
    expect(screen.getAllByText(day25)).toHaveLength(1);
    expect(screen.getAllByText(day26)).toHaveLength(1);
  });

  it("survives a turn with no timestamp (no divider, no crash)", () => {
    render(<TranscriptView entries={[turn({ ts: "" })]} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});

// Grouping: a real thread is overwhelmingly long runs of assistant turns, so only the first turn of
// a run carries the role/time header. Without this the scroll length roughly doubles with nothing
// new in it.
describe("TranscriptView — speaker grouping", () => {
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const at = "2026-07-25T06:22:21.253Z";

  it("times only the first of your consecutive messages", () => {
    render(
      <TranscriptView
        entries={[
          turn({ uuid: "u1", parts: [{ kind: "text", text: "one" }] }),
          turn({ uuid: "u2", parts: [{ kind: "text", text: "two" }] }),
          turn({ uuid: "u3", parts: [{ kind: "text", text: "three" }] }),
        ]}
      />,
    );
    expect(screen.getAllByText(time(at))).toHaveLength(1);
    // Every turn's content still renders — only the repeated time is suppressed.
    for (const t of ["one", "two", "three"]) expect(screen.getByText(t)).toBeInTheDocument();
  });

  it("times your message again after the agent answers", () => {
    render(
      <TranscriptView
        entries={[
          turn({ uuid: "u1", parts: [{ kind: "text", text: "ask" }] }),
          turn({ uuid: "a1", role: "assistant", parts: [{ kind: "text", text: "answer" }] }),
          turn({ uuid: "u2", parts: [{ kind: "text", text: "follow up" }] }),
        ]}
      />,
    );
    expect(screen.getAllByText(time(at))).toHaveLength(2);
  });

  it("a day divider restarts the run even for the same speaker", () => {
    render(
      <TranscriptView
        entries={[
          turn({ uuid: "u1", ts: "2026-07-25T06:00:00.000Z" }),
          turn({ uuid: "u2", ts: "2026-07-26T06:00:00.000Z" }),
        ]}
      />,
    );
    expect(screen.getAllByText(time("2026-07-25T06:00:00.000Z"))).toHaveLength(2);
  });
});

// Machine-injected content (a background task finishing, another session's message, a loaded
// skill) is real, but it is NOT speech: one quiet line each, never a bubble or a block, its body
// behind the line.
describe("TranscriptView — system notes", () => {
  it("draws a note as one line attributed to neither party, with no box around it", () => {
    const { container } = render(
      <TranscriptView entries={[turn({ role: "note", parts: [{ kind: "context", label: 'Agent "issue 8 fixes" finished', text: "" }] })]} />,
    );
    expect(screen.getByText('Agent "issue 8 fixes" finished')).toBeInTheDocument();
    // Nothing more to show, so nothing offers to open.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/System/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-speaker]')).toBeNull();
    expect(container.querySelector(".border-dashed")).toBeNull();
  });

  it("keeps a note's body behind its line until tapped", async () => {
    render(<TranscriptView entries={[turn({ role: "note", parts: [{ kind: "context", label: "Message from nenustop", text: "PR #63 is green, not merged." }] })]} />);
    expect(screen.queryByText("PR #63 is green, not merged.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Message from nenustop", expanded: false }));
    expect(screen.getByText("PR #63 is green, not merged.")).toBeInTheDocument();
  });

  // The web is live the moment it is built; the bridge only after a restart, so an older bridge's
  // notes (plain text) still read as one line: their first line, the rest behind it.
  it("draws an older bridge's text note as its first line", async () => {
    render(<TranscriptView entries={[turn({ role: "note", parts: [{ kind: "text", text: "Stop hook feedback: fix these\n- app.tsx: missing test" }] })]} />);
    expect(screen.queryByText(/missing test/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop hook feedback: fix these", expanded: false }));
    expect(screen.getByText(/missing test/)).toBeInTheDocument();
  });

  it("keeps a compaction summary distinct from an ordinary note", () => {
    render(
      <TranscriptView
        entries={[
          turn({ uuid: "s", role: "summary", parts: [{ kind: "text", text: "…prior…" }] }),
          turn({ uuid: "n", role: "note", parts: [{ kind: "context", label: "task done", text: "" }] }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Context compacted" })).toBeInTheDocument();
    expect(screen.getByText("task done")).toBeInTheDocument();
  });

  it("shows the command the operator typed in their bubble, and the skill it loaded as a line beside it", async () => {
    const { container } = render(<TranscriptView entries={[turn({ role: "user", parts: [
      { kind: "text", text: "/designboard Rediseño del checkout" },
      { kind: "context", label: "Skill · designboard", text: "Base directory for this skill: /skills/designboard" },
    ] })]} />);
    const bubble = container.querySelector('[data-speaker="user"] > div')!;
    expect(bubble).toHaveTextContent("/designboard Rediseño del checkout");
    expect(bubble).not.toHaveTextContent("Skill");
    expect(screen.queryByText(/Base directory/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skill · designboard", expanded: false }));
    expect(screen.getByText(/Base directory for this skill/)).toBeInTheDocument();
  });

  it("opens a folded line whose body holds the searched words", () => {
    render(<TranscriptView query="green" entries={[turn({ role: "note", parts: [{ kind: "context", label: "Message from nenustop", text: "PR #63 is green." }] })]} />);
    expect(screen.getByRole("button", { name: "Message from nenustop", expanded: true })).toBeInTheDocument();
  });
});

describe("TranscriptView — work folding", () => {
  const activity = turn({ uuid: "work-entry", role: "assistant", turnId: "native-turn", phase: "commentary",
    parts: [{ kind: "text", text: "Checking the import graph." }, { kind: "thinking", text: "Compare dependency direction." }],
    turn: { status: "running", startedAt: "2026-07-25T06:22:00Z" } });
  const final = turn({ uuid: "final-entry", role: "assistant", turnId: "native-turn", phase: "final_answer",
    parts: [{ kind: "text", text: "The dependency cycle is fixed." }],
    turn: { status: "completed", durationMs: 21_000 } });

  it("collapses completed work while leaving the answer and measured duration visible", async () => {
    render(<TranscriptView entries={[activity, final]} activityStatus="done" />);
    const fold = screen.getByRole("button", { name: "Worked for 21s", expanded: false });
    expect(screen.getByText("The dependency cycle is fixed.")).toBeVisible();
    expect(screen.queryByText("Checking the import graph.")).not.toBeInTheDocument();
    await userEvent.click(fold);
    expect(screen.getByText("Checking the import graph.")).toBeVisible();
    expect(screen.getByText("The dependency cycle is fixed.")).toBeVisible();
    await userEvent.click(fold);
    expect(screen.queryByText("Checking the import graph.")).not.toBeInTheDocument();
    expect(screen.getByText("The dependency cycle is fixed.")).toBeVisible();
  });

  it("opens active work, then collapses it automatically on completion", () => {
    const { rerender } = render(<TranscriptView entries={[activity]} activityStatus="working" />);
    expect(screen.getByRole("button", { name: /^Thinking|^Working/, expanded: true })).toBeInTheDocument();
    expect(screen.getByText("Checking the import graph.")).toBeVisible();
    rerender(<TranscriptView entries={[activity, final]} activityStatus="done" />);
    expect(screen.getByRole("button", { name: "Worked for 21s", expanded: false })).toBeInTheDocument();
    expect(screen.queryByText("Checking the import graph.")).not.toBeInTheDocument();
    expect(screen.getByText("The dependency cycle is fixed.")).toBeVisible();
  });

  it("preserves an explicit open choice so completion does not remove work being read", async () => {
    const { rerender } = render(<TranscriptView entries={[activity]} activityStatus="working" />);
    const fold = screen.getByRole("button", { name: /^Thinking|^Working/, expanded: true });
    await userEvent.click(fold);
    await userEvent.click(fold);
    rerender(<TranscriptView entries={[activity, final]} activityStatus="done" />);
    expect(screen.getByRole("button", { name: "Worked for 21s", expanded: true })).toBeInTheDocument();
    expect(screen.getByText("Checking the import graph.")).toBeVisible();
    expect(screen.getByText("The dependency cycle is fixed.")).toBeVisible();
  });

  it("a query opens completed work and its matching thinking detail, then restores the fold", () => {
    const { rerender } = render(<TranscriptView entries={[activity, final]} activityStatus="done" query="dependency direction" />);
    expect(screen.getByRole("button", { name: "Worked for 21s", expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thinking", expanded: true })).toBeInTheDocument();
    expect(screen.getByText("dependency direction")).toBeVisible();
    rerender(<TranscriptView entries={[activity, final]} activityStatus="done" />);
    expect(screen.getByRole("button", { name: "Worked for 21s", expanded: false })).toBeInTheDocument();
  });

  it("a focused tool entry opens all nested disclosures and has one scroll marker", () => {
    const action = turn({ uuid: "tool-entry", role: "assistant", turnId: "native-turn", parts: [{ kind: "tool", name: "Read", summary: "src/app.ts", result: { text: "source contents" } }] });
    const { container } = render(<TranscriptView entries={[action, final]} activityStatus="done" focusedUuid="tool-entry" />);
    expect(screen.getByRole("button", { name: /^Worked for 21s/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1 tool call/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read src/app.ts", expanded: true })).toBeInTheDocument();
    expect(screen.getByText("source contents")).toBeVisible();
    expect(container.querySelectorAll('[data-turn="tool-entry"]')).toHaveLength(1);
  });

  it("preserves an expanded fold when older unrelated turns are prepended", async () => {
    const { rerender } = render(<TranscriptView entries={[activity, final]} activityStatus="done" />);
    await userEvent.click(screen.getByRole("button", { name: "Worked for 21s" }));
    const old = turn({ uuid: "old-work", role: "assistant", turnId: "old-turn", parts: [{ kind: "tool", name: "Read", summary: "old.ts" }], turn: { status: "completed" } });
    rerender(<TranscriptView entries={[old, activity, final]} activityStatus="done" />);
    expect(screen.getByRole("button", { name: "Worked for 21s", expanded: true })).toBeInTheDocument();
    expect(screen.getByText("Checking the import graph.")).toBeVisible();
  });
});

it("shows uploaded images as compact previews instead of local paths", () => {
  const path = "/Users/operator/.local/state/collie/uploads/pane-mabcd123-1234abcd.png";
  render(<FileMediaContext.Provider value={() => "/api/preview.png"}>
    <TranscriptView entries={[turn({ parts: [{ kind: "text", text: `Look at this ${path}` }] })]} />
  </FileMediaContext.Provider>);
  expect(screen.getByRole("img")).toHaveAttribute("src", "/api/preview.png");
  expect(screen.queryByText(path, { exact: false })).not.toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAccessibleName("Image 1");
});

it("keeps the agent question visible when its work log is collapsed", () => {
  render(<TranscriptView entries={[turn({ role: "assistant", turn: { status: "completed" }, parts: [{ kind: "tool", name: "request_user_input_async", summary: "Question", questions: [{ title: "Which source?", options: ["Web", "Instagram"] }] }] })]} />);
  expect(screen.getByRole("region", { name: "Agent question" })).toBeVisible();
  expect(screen.getByText("Which source?")).toBeVisible();
});

it("prepares a selected question answer without submitting a terminal action", async () => {
  const prepare = vi.fn();
  render(<QuestionReplyContext.Provider value={prepare}><TranscriptView entries={[turn({ role: "assistant", turn: { status: "completed" }, parts: [{ kind: "tool", name: "request_user_input_async", summary: "Question", questions: [{ title: "Which source?", options: ["Web", "Instagram"] }] }] })]} /></QuestionReplyContext.Provider>);
  await userEvent.click(screen.getByRole("button", { name: "Instagram" }));
  expect(prepare).toHaveBeenCalledWith("Which source?\nInstagram");
});

describe("journal media", () => {
  const withViewer = (ui: React.ReactNode) => <FilePreviewProvider paneId="w1:p1">{ui}</FilePreviewProvider>;
  // /history sends image markers with no text; the web union does not list them yet.
  const image = (index: number) => ({ kind: "image", index, mediaType: "image/png" }) as unknown as TranscriptEntry["parts"][number];

  it("shows a pasted image from the journal by entry and index, without a path or a crash", () => {
    render(withViewer(<TranscriptView query="look" entries={[turn({ uuid: "u-paste", parts: [{ kind: "text", text: "[Image #1] look" }, image(0)] })]} />));
    expect(screen.getByRole("img", { name: "Image 1" })).toHaveAttribute("src", "/api/pane/w1%3Ap1/journal-image?entry=u-paste&n=0");
  });

  it("shows what a tool returned as thumbnails, addressed through the entry that made the call", async () => {
    render(withViewer(<TranscriptView activityStatus="working" entries={[
      turn({ uuid: "ask", parts: [{ kind: "text", text: "check the screenshot" }] }),
      turn({ uuid: "call", role: "assistant", parts: [{ kind: "tool", name: "Read", summary: "/tmp/shot.png", result: { text: "", attachments: [{ kind: "image", index: 0, mediaType: "image/png" }] } }] }),
    ]} />));
    expect(await screen.findByRole("img", { name: "Image 1" })).toHaveAttribute("src", "/api/pane/w1%3Ap1/journal-image?entry=call&n=0");
  });

  it("keeps the images of folded work visible as one gallery for the turn", () => {
    render(withViewer(<TranscriptView activityStatus="done" entries={[
      turn({ uuid: "ask", parts: [{ kind: "text", text: "shots" }] }),
      turn({ uuid: "call", role: "assistant", turn: { status: "completed" }, parts: [{ kind: "tool", name: "Read", summary: "a.png", result: { text: "", attachments: [0, 1, 2, 3, 4].map((index) => ({ kind: "image" as const, index })) } }] }),
      turn({ uuid: "done", role: "assistant", phase: "final_answer", turn: { status: "completed" }, parts: [{ kind: "text", text: "Done." }] }),
    ]} />));
    expect(screen.getByRole("button", { name: /^Worked/, expanded: false })).toBeInTheDocument();
    const strip = screen.getByRole("list", { name: "Images from this turn" });
    expect(strip.querySelectorAll("img")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Open 2 more images" })).toBeInTheDocument();
  });

  it("shows a delivered HTML file as a card that mounts no frame until opened", async () => {
    render(withViewer(<TranscriptView activityStatus="done" entries={[
      turn({ uuid: "ask", parts: [{ kind: "text", text: "make a page" }] }),
      turn({ uuid: "send", role: "assistant", turn: { status: "completed" }, parts: [{ kind: "tool", name: "SendUserFile", summary: "/tmp/out/report.html", result: { text: "sent", attachments: [{ kind: "file", path: "/tmp/out/report.html" }] } }] }),
      turn({ uuid: "done", role: "assistant", phase: "final_answer", turn: { status: "completed" }, parts: [{ kind: "text", text: "Here it is." }] }),
    ]} />));
    const card = screen.getByRole("button", { name: "Open report.html" });
    expect(card).toHaveTextContent("HTML page · out/");
    expect(document.querySelector("iframe")).toBeNull();
    await userEvent.click(card);
    const frame = await screen.findByTitle("Rendered preview of report.html");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  });

  // The designboard pane's compaction summary named files relative to other folders; each became an
  // Open card that answered 404. A recap or a system note names files, it does not hand them over.
  it("shows no cards for the files a compaction summary or a system note names", async () => {
    render(withViewer(<TranscriptView entries={[
      turn({ uuid: "s", role: "summary", parts: [{ kind: "text", text: "Key files: `assets/canvas.template.html`, the real one `real/scroll.html`, shots in frames/frame1.png." }] }),
      turn({ uuid: "n", role: "note", parts: [{ kind: "text", text: "Base directory for this skill: /skills/designboard\n\nOpen assets/canvas.template.html or report.html" }] }),
    ]} />));
    await userEvent.click(screen.getByRole("button", { name: "Context compacted" }));
    await userEvent.click(screen.getByRole("button", { name: /^Base directory for this skill/ }));
    expect(screen.queryByRole("button", { name: /^Open / })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // The names stay in the text, and a code-formatted one still opens by name.
    expect(screen.getByRole("button", { name: "assets/canvas.template.html" })).toBeEnabled();
  });

  it("opens a card at the file the bridge finds and says so when nothing is there", async () => {
    let written = false;
    server.use(http.get(/\/api\/pane\/[^/]+\/files$/, ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.getAll("inspect").map((path) => path === "later.html" && !written
        ? { path, state: "missing" }
        : { path, state: "preview", resolved: `/repo/${path}` }))));
    render(withViewer(<TranscriptView entries={[turn({ role: "assistant", parts: [{ kind: "text", text: "Edited `assets/canvas.template.html`; writing `later.html` next." }] })]} />));
    const later = await screen.findByRole("button", { name: "later.html: file not found" });
    expect(later).toHaveTextContent("Not found");
    await userEvent.click(screen.getByRole("button", { name: "Open canvas.template.html" }));
    expect(await screen.findByText("/repo/assets/canvas.template.html")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close document" }));
    // A tap on a missing card asks again, and opens once the agent has written the file.
    await userEvent.click(later);
    expect(screen.queryByText("/repo/later.html")).not.toBeInTheDocument();
    written = true;
    await userEvent.click(later);
    expect(await screen.findByText("/repo/later.html")).toBeInTheDocument();
  });

  it("renders a local Markdown image in place and keeps it out of the media list below", () => {
    render(withViewer(<TranscriptView entries={[turn({ role: "assistant", parts: [{ kind: "text", text: "Before ![the home screen](shots/home.png) after" }] })]} />));
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("alt", "the home screen");
    expect(images[0]).toHaveAttribute("src", "/api/pane/w1%3Ap1/file?path=shots%2Fhome.png");
  });
});

it("treats an AskUserQuestion that already has its answer as closed", () => {
  render(<QuestionReplyContext.Provider value={vi.fn()}><TranscriptView entries={[turn({ role: "assistant", turn: { status: "completed" }, parts: [{ kind: "tool", name: "AskUserQuestion", summary: "Question", questions: [{ title: "Which source?", options: ["Web", "Instagram"] }], result: { text: "User answered: Web" } }] })]} /></QuestionReplyContext.Provider>);
  expect(screen.getByRole("button", { name: "Instagram" })).toBeDisabled();
});

it("leaves a live question to the card under it", () => {
  const asked = [turn({ role: "assistant", turn: { status: "running" }, parts: [{ kind: "tool", name: "AskUserQuestion", summary: "Question", questions: [{ title: "Which source?", options: ["Web", "Instagram"] }] }] })];
  const { rerender } = render(<QuestionReplyContext.Provider value={vi.fn()}><TranscriptView entries={asked} /></QuestionReplyContext.Provider>);
  expect(screen.getByRole("region", { name: "Agent question" })).toBeInTheDocument();
  rerender(<QuestionLiveContext.Provider value><QuestionReplyContext.Provider value={vi.fn()}><TranscriptView entries={asked} /></QuestionReplyContext.Provider></QuestionLiveContext.Provider>);
  expect(screen.queryByRole("region", { name: "Agent question" })).not.toBeInTheDocument();
});
