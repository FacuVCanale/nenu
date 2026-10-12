import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { ColumnPage } from "./column-page";
import type { HomeData } from "@/lib/loaders";

const data: HomeData = {
  bridge: "connected", agents: [], shellPanes: [], workspaces: [], tabs: [], projects: [], device: undefined, sessions: [],
  session: undefined, snoozedUntil: null, update: undefined, error: false, authError: false,
};

// What a screen reader and a sighted reader both get: a title faded out is also hidden from AT.
const visible = { ignore: '[aria-hidden="true"], [aria-hidden="true"] *' };
const headerTitle = () => screen.queryByText("AWAM Comercio SaaS", { ...visible, selector: "header *" });

/** Stands in for the browser's IntersectionObserver, which jsdom lacks; `scroll` reports the heading in or out of view. */
function observeIntersections() {
  const watched: Array<{ target: Element; callback: IntersectionObserverCallback; root: Element | Document | null | undefined }> = [];
  vi.stubGlobal("IntersectionObserver", class {
    callback: IntersectionObserverCallback;
    root: Element | Document | null | undefined;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = callback;
      this.root = options?.root;
    }
    observe(target: Element) { watched.push({ target, callback: this.callback, root: this.root }); }
    disconnect() { watched.length = 0; }
    unobserve() {}
    takeRecords() { return []; }
  });
  return {
    watched,
    /** One delivery per observer: several states at once arrive the way a busy page gets them, oldest first. */
    scroll(...inView: boolean[]) {
      act(() => watched.forEach(({ target, callback }) =>
        callback(inView.map((isIntersecting) => ({ target, isIntersecting }) as IntersectionObserverEntry), {} as IntersectionObserver)));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

function renderPage(path: string, children = <h2>AWAM Comercio SaaS</h2>) {
  return render(<MemoryRouter initialEntries={[path]}><ColumnPage data={data} title="AWAM Comercio SaaS">{children}</ColumnPage></MemoryRouter>);
}

describe("ColumnPage — the large title", () => {
  it("shows the header title only once the page's heading has scrolled under the header", () => {
    const io = observeIntersections();
    renderPage("/project/awam");
    // The page's own heading is watched inside the page's scroller.
    expect(io.watched.map(({ target }) => target.textContent)).toEqual(["AWAM Comercio SaaS"]);
    expect(io.watched[0]!.root).toBe(screen.getByRole("main"));
    expect(headerTitle()).toBeNull();
    io.scroll(false);
    expect(headerTitle()).toBeInTheDocument();
    io.scroll(true);
    expect(headerTitle()).toBeNull();
  });

  it("goes by the latest of several crossings delivered at once", () => {
    const io = observeIntersections();
    renderPage("/project/awam");
    // Flung down and back up while the page was busy: the heading ends in view, so the bar stays empty.
    io.scroll(false, true);
    expect(headerTitle()).toBeNull();
    io.scroll(true, false);
    expect(headerTitle()).toBeInTheDocument();
  });

  it("keeps the header title when the page's heading names something else", () => {
    const io = observeIntersections();
    // A node page titled by its project, over the node's own heading: the bar must not go empty.
    renderPage("/project/awam/node/t-0102", <h2>Rediseño mobile</h2>);
    expect(io.watched).toEqual([]);
    expect(headerTitle()).toBeInTheDocument();
  });

  it("watches the heading that says the title, wherever it sits among the page's headings", () => {
    const io = observeIntersections();
    renderPage("/project/awam", <><h1>Needs you</h1><h2>AWAM Comercio SaaS</h2></>);
    expect(io.watched.map(({ target }) => target.textContent)).toEqual(["AWAM Comercio SaaS"]);
    expect(headerTitle()).toBeNull();
  });

  it("keeps the header title when the page draws no heading", () => {
    observeIntersections();
    renderPage("/project/awam", <p>Project not found in this Herdr session.</p>);
    expect(headerTitle()).toBeInTheDocument();
  });

  it("keeps the header title where the browser cannot watch the heading", () => {
    renderPage("/project/awam");
    expect(headerTitle()).toBeInTheDocument();
  });

  it("leads with a back to Home, or to the parent a page names", () => {
    observeIntersections();
    const { unmount } = renderPage("/project/awam");
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    unmount();
    render(<MemoryRouter initialEntries={["/project/awam/node/t-1"]}>
      <ColumnPage data={data} title="AWAM Comercio SaaS" back={{ to: "/project/awam", label: "AWAM Comercio SaaS" }}><h2>Rediseño</h2></ColumnPage>
    </MemoryRouter>);
    expect(screen.getByRole("link", { name: "Back to AWAM Comercio SaaS" })).toHaveAttribute("href", "/project/awam");
  });
});
