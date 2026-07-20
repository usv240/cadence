import Link from "next/link";
import { LandingThemeToggle } from "./landing-theme-toggle";

const steps = [
  ["1", "Listens", "Keeps up with the room using live captions."],
  ["2", "Prepares your next turn", "Stages grounded replies in your voice while people are still talking."],
  ["3", "Choose, repair, or steer", "Choose a ready thought, correct the context, change the tone, or add an idea."],
  ["4", "Speak and lead", "Say what you mean, hold the floor, or start something of your own."],
];

const impactPrinciples = [
  ["Be ready before the turn", "Cadence prepares choices while the conversation is still moving, so a thought can arrive in time to matter."],
  ["Keep agency with the person", "AI suggests. The person chooses, edits, changes the tone, starts a topic, or says nothing at all."],
  ["Stay connected when technology fails", "Needs, feelings, saved replies, a backup board, and device speech remain available when the network does not."],
];

export default function LandingPage() {
  return (
    <main className="landing-page min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
        <Link href="/" className="flex items-center gap-3 rounded-xl font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]"><span className="landing-mark grid h-10 w-10 place-items-center rounded-xl text-lg text-white">C</span><span className="text-xl tracking-tight">Cadence</span></Link>
        <div className="flex items-center gap-1 sm:gap-2"><LandingThemeToggle /><Link href="/app" className="landing-open-demo min-h-11 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Open demo</Link></div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:gap-12 lg:pb-24 lg:pt-16">
        <div><p className="eyebrow">Conversation, on your terms</p><h1 className="mt-4 max-w-3xl text-5xl font-bold tracking-[-0.045em] sm:text-6xl lg:text-7xl">Be in the conversation again.</h1><p className="landing-copy mt-6 max-w-xl text-lg leading-relaxed">Cadence listens ahead and stages the words you may want to say, so you can respond, repair a misunderstanding, hold the floor, or start something new before the moment moves on.</p><div className="mt-8 flex flex-wrap gap-3"><Link href="/app" className="landing-primary min-h-14 rounded-2xl px-6 py-4 text-base font-bold text-white shadow-lg transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Try the live demo</Link><a href="#how-it-works" className="landing-secondary min-h-14 rounded-2xl border px-6 py-4 text-base font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">See how it works</a></div></div>
        <div className="landing-preview rounded-[2rem] border p-5 shadow-card"><div className="landing-preview-inner rounded-3xl p-5"><p className="eyebrow">Ready to say</p><p className="mt-3 text-xl font-bold leading-relaxed">“I love that idea, kiddo. A little fresh air sounds like the right playlist.”</p><div className="landing-preview-status mt-5 flex items-center justify-between border-t pt-4 text-sm font-bold"><span>One tap to speak</span><span aria-hidden="true">Ready</span></div></div><p className="landing-copy px-3 pb-1 pt-5 text-sm font-semibold">The room moves fast. Your voice should not have to wait.</p></div>
      </section>

      <section className="px-5 pb-2 sm:px-8"><p className="landing-assurance mx-auto max-w-6xl rounded-2xl border px-5 py-4 text-center text-lg font-bold leading-relaxed">No training for anyone else. They just talk - Cadence listens and gets your words ready.</p></section>
      <section className="landing-surface border-y"><div className="mx-auto max-w-6xl px-5 py-16 sm:px-8"><p className="eyebrow">The problem</p><div className="mt-4 grid gap-8 md:grid-cols-[.9fr_1.1fr]"><h2 className="text-3xl font-bold tracking-tight sm:text-4xl">A conversation does not wait for a keyboard.</h2><p className="landing-copy text-lg leading-relaxed">Typical conversation moves at <strong>100–140 words per minute.</strong> Many AAC users communicate at <strong>3–20 words per minute.</strong> The gap is not just speed. It is timing, personality, and presence.</p></div></div></section>
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr]"><div><p className="eyebrow">What impact means</p><h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">More ways to take part, on your own terms.</h2><p className="landing-copy mt-4 text-lg leading-relaxed">Cadence is designed to protect the moments that are often lost first: a reaction, a joke, a boundary, a need, or a story someone wants to begin.</p><p className="landing-copy mt-4 text-sm leading-relaxed">We measure participation—not only taps saved—through replies spoken, conversations initiated, time to response, and whether suggestions feel like the person&apos;s own words.</p></div><div className="grid gap-4 sm:grid-cols-3">{impactPrinciples.map(([title, description]) => <article key={title} className="landing-card rounded-3xl border p-6 shadow-sm"><h3 className="text-lg font-bold leading-snug">{title}</h3><p className="landing-copy mt-3 text-sm leading-relaxed">{description}</p></article>)}</div></div></section>
      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><p className="eyebrow">How it works</p><h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">A faster path from thought to voice.</h2><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{steps.map(([number, title, description]) => <article key={number} className="landing-card rounded-3xl border p-6 shadow-sm"><span className="landing-step grid h-10 w-10 place-items-center rounded-full text-sm font-black">{number}</span><h3 className="mt-5 text-xl font-bold">{title}</h3><p className="landing-copy mt-2 leading-relaxed">{description}</p></article>)}</div></section>
      <section className="landing-inverse px-5 py-20 sm:px-8"><div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2"><div><p className="landing-inverse-eyebrow text-xs font-bold uppercase tracking-[0.16em]">Why it&apos;s different</p><h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Participation, not just faster typing.</h2></div><p className="landing-inverse-copy text-lg leading-relaxed">Cadence is built for the whole live turn: respond to what was said, repair context when it is wrong, hold space when you need time, and initiate what matters to you. The person—not the AI—chooses every word.</p></div></section>
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="landing-callout rounded-[2rem] p-8 sm:p-12"><p className="eyebrow">Who it&apos;s for</p><h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">For people with ALS who want more than a way to type.</h2><p className="landing-copy mt-4 max-w-2xl text-lg leading-relaxed">For the people who want to share the story, land the punchline, and be heard while the moment is still theirs.</p><Link href="/app" className="landing-primary mt-7 inline-flex min-h-14 items-center rounded-2xl px-6 py-4 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Try the live demo</Link></div></section>
      <footer className="landing-footer border-t px-5 py-8 text-center text-sm font-medium">Cadence — every voice deserves its moment.</footer>
    </main>
  );
}
