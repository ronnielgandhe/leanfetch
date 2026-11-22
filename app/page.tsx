import { Scanner } from "@/components/scanner";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[920px] px-4 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <span className="font-mono text-[14px] text-ink">
          leanfetch<span className="text-accent">.</span>
        </span>
        <nav className="flex items-center gap-5">
          <a href="https://github.com/ronnielgandhe/leanfetch" target="_blank" rel="noreferrer" className="font-mono text-[12px] text-muted hover:text-ink">
            github
          </a>
          <ThemeToggle />
        </nav>
      </header>

      <main className="pb-24">
        <section className="pb-10 pt-10 sm:pt-16">
          <h1 className="max-w-[760px] font-serif text-[44px] leading-[1.02] tracking-[-0.01em] text-ink sm:text-[68px]">
            stop paying for api calls <em className="text-accent">you don&apos;t need.</em>
          </h1>
          <p className="mt-6 max-w-[560px] text-[16px] leading-relaxed text-muted">
            a tool that stops startups from losing cash to unnecessary api calls. paste a public github repo or drop your code, get a report of the wasteful llm and api patterns in it, with a savings estimate you can poke at.
          </p>
          <p className="mt-3 font-mono text-[12px] text-faint">static analysis · free · no account · nothing stored</p>
        </section>

        <Scanner />

        <section className="mt-24 grid gap-8 border-t border-line pt-10 text-[14px] leading-relaxed text-muted sm:grid-cols-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink">what it checks</p>
            <p className="mt-2">llm calls in loops, missing output caps, retry storms, big models on tiny tasks, uncached prompts, ever-growing chat history, whole files in prompts, unbatched embeddings, repeat calls, batch api candidates, tight polling and duplicate fetches.</p>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink">how</p>
            <p className="mt-2">regex plus light structure parsing over js, ts and python, with cross-file tracking of wrapper functions. it only reports what it can point to in the code, with a confidence level.</p>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink">the math</p>
            <p className="mt-2">your traffic is unknown to us, so the dollar numbers come from assumptions you set. the formula is on the page and the prices come from the providers&apos; pricing pages.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-6 font-mono text-[12px] text-faint">
        built by ronniel gandhe and violet li. mit licensed.
      </footer>
    </div>
  );
}
