import Link from "next/link";

const landscape = [
  {
    category: "Established AAC systems",
    examples: "Symbol boards, text-to-speech apps, and dedicated AAC software",
    evidence: "Established AAC tools provide vocabulary, symbols, text, speech, and configurable access methods.",
    cadence: "Cadence is a complementary live-conversation layer. It stages short options from the current conversation, while the person chooses every word.",
    source: { label: "ASHA AAC Practice Portal", href: "https://www.asha.org/practice-portal/professional-issues/augmentative-and-alternative-communication/" },
  },
  {
    category: "Predictive text research",
    examples: "Google SpeakFaster",
    evidence: "SpeakFaster studies language-model assisted text entry for AAC users, including motor-action savings in offline simulation and user evaluation.",
    cadence: "Cadence takes inspiration from multiple candidate choices, then focuses on a live room transcript, quick reactions, repair, floor-holding, and user-led openers.",
    source: { label: "SpeakFaster, Nature Communications", href: "https://www.nature.com/articles/s41467-024-53873-3" },
  },
  {
    category: "Personal voice and live speech",
    examples: "Apple Personal Voice and Live Speech",
    evidence: "Personal Voice and Live Speech help people create or choose a voice and type text for speech output.",
    cadence: "Cadence offers browser device speech or selected cloud speech, plus an optional writing-style card to guide wording. It does not claim to replace voice banking or cloning.",
    source: { label: "Apple Accessibility", href: "https://www.apple.com/accessibility/" },
  },
  {
    category: "Atypical-speech recognition",
    examples: "Voiceitt",
    evidence: "Voiceitt is designed to recognize a person's non-standard speech for communication, dictation, and captions.",
    cadence: "Cadence instead listens to the surrounding conversation and can turn a short spoken or typed idea into candidate replies. These are different needs and can be complementary.",
    source: { label: "Voiceitt", href: "https://voiceitt.com/" },
  },
  {
    category: "Dedicated eye-gaze AAC",
    examples: "Tobii Dynavox eye-gaze systems",
    evidence: "Dedicated products support eye gaze, touch, and switch access across comprehensive AAC solutions.",
    cadence: "Cadence's local-camera eye-gaze focus is an experimental browser access option. It is not a substitute for a dedicated eye-tracking system or AAC assessment.",
    source: { label: "Tobii Dynavox overview", href: "https://downloads.tobiidynavox.com/Other/Tradeshow/Event-Product-Brochure_Letter_TD_en-US.pdf" },
  },
];

const research = [
  ["AAC fit and support", "AAC outcomes depend on the person, access method, environment, and communication partners.", "https://www.asha.org/practice-portal/professional-issues/augmentative-and-alternative-communication/"],
  ["AAC abandonment", "Effort, training, support, and fit can affect adoption.", "https://pubmed.ncbi.nlm.nih.gov/17114167/"],
  ["Eye control and switch scanning", "Access-method choice should consider both performance and qualitative feedback.", "https://pubs.asha.org/doi/10.1044/aac19.3.64"],
  ["Cognitive accessibility", "Limiting distractions and unnecessary content helps people stay focused on their task.", "https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/"],
  ["WCAG 2.2", "Target size, keyboard access, and visible focus are baseline web-access considerations.", "https://www.w3.org/TR/WCAG22/"],
];

export default function ResearchPage() {
  return <main className="landing-page min-h-screen"><header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8 sm:py-6"><Link href="/" className="flex items-center gap-3 rounded-xl font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]"><span className="landing-mark grid h-10 w-10 place-items-center rounded-xl text-lg text-white">C</span><span className="text-xl tracking-tight">Cadence</span></Link><Link href="/app" className="landing-open-demo min-h-11 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Open Cadence</Link></header><section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16"><p className="eyebrow">Research and comparison</p><h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-6xl">Built with the field, not against it.</h1><p className="landing-copy mt-6 max-w-3xl text-lg leading-relaxed">Cadence is an early communication prototype. It is designed to complement, not replace, AAC assessment, dedicated access systems, voice banking, or established AAC software. These sources explain the design choices and the boundaries of our claims.</p></section><section className="landing-surface border-y"><div className="mx-auto max-w-6xl px-5 py-16 sm:px-8"><h2 className="text-3xl font-bold tracking-tight">Where Cadence fits</h2><div className="mt-8 overflow-x-auto rounded-3xl border"><table className="min-w-[760px] w-full text-left text-sm"><thead className="bg-[#edf5ef] text-[#173d3a]"><tr><th className="p-4 font-bold">Category</th><th className="p-4 font-bold">What it addresses</th><th className="p-4 font-bold">Cadence&apos;s complementary role</th></tr></thead><tbody>{landscape.map((item) => <tr key={item.category} className="border-t align-top"><td className="p-4 font-bold text-[#173d3a]"><p>{item.category}</p><p className="mt-1 font-medium text-[#60766e]">{item.examples}</p></td><td className="p-4 leading-relaxed text-[#4e6960]">{item.evidence} <a className="font-bold text-[#1f7a57] underline underline-offset-2" href={item.source.href} target="_blank" rel="noreferrer">Source: {item.source.label}</a></td><td className="p-4 leading-relaxed text-[#4e6960]">{item.cadence}</td></tr>)}</tbody></table></div></div></section><section className="mx-auto max-w-6xl px-5 py-16 sm:px-8"><p className="eyebrow">Research used</p><h2 className="mt-3 text-3xl font-bold tracking-tight">Design evidence, clearly attributed.</h2><div className="mt-8 grid gap-4 md:grid-cols-2">{research.map(([title, insight, href]) => <article key={title} className="landing-card rounded-3xl border p-6 shadow-sm"><h3 className="text-lg font-bold">{title}</h3><p className="landing-copy mt-3 leading-relaxed">{insight}</p><a href={href} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center font-bold text-[#1f7a57] underline underline-offset-2 focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Read source</a></article>)}</div><aside className="landing-callout mt-10 rounded-3xl p-6"><p className="font-bold">What this does not prove</p><p className="landing-copy mt-2 leading-relaxed">These sources inform the product design. They do not validate Cadence itself, demonstrate clinical effectiveness, or prove that Cadence is superior to another tool. Voluntary usability feedback is still required.</p></aside></section><footer className="landing-footer border-t px-5 py-8 text-center text-sm font-medium"><Link href="/" className="underline underline-offset-2">Back to Cadence</Link></footer></main>;
}
