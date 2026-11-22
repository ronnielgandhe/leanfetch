export default function Header() {
  return (
    <header className="border-b border-[rgba(0,0,0,0.06)] bg-white sticky top-0 z-10">
      <div className="max-w-content mx-auto px-6 md:px-12 py-4 flex items-center gap-1.5">
        <svg className="w-6 h-6" viewBox="0 0 36 36" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 13h16c4 0 6 3 6 6s-2 6-6 6H13"/>
          <polyline points="17 21 13 25 17 29"/>
        </svg>
        <h1 className="text-lg font-light tracking-tight text-[#1A1A1A]">LeanFetch</h1>
      </div>
    </header>
  );
}
