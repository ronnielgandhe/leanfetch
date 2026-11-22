'use client';

import { useState, useEffect, useRef } from 'react';

export default function SplashScreen({ onComplete }) {
  const [phase, setPhase] = useState(0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),    // "Lean" fades in
      setTimeout(() => setPhase(2), 600),    // Logo + "Fetch" appear simultaneously
      setTimeout(() => setPhase(3), 1700),   // whole splash begins fade-out
      setTimeout(() => onCompleteRef.current(), 2300), // done, remove splash
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div
      className={`fixed inset-0 bg-white z-50 flex items-center justify-center transition-opacity duration-500 ${
        phase >= 3 ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="flex items-center select-none">
        {/* Logo: appears with Fetch */}
        <svg
          className={`w-14 h-14 md:w-[4.5rem] md:h-[4.5rem] mr-2 md:mr-3 splash-logo ${
            phase >= 2 ? 'splash-logo-active' : ''
          }`}
          viewBox="0 0 36 36"
          fill="none"
          stroke="#1A1A1A"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 13h16c4 0 6 3 6 6s-2 6-6 6H13"/>
          <polyline points="17 21 13 25 17 29"/>
        </svg>

        <span
          className={`text-6xl md:text-8xl font-light tracking-tight text-[#1A1A1A] splash-lean ${
            phase >= 1 ? 'splash-lean-active' : ''
          }`}
        >
          Lean
        </span>
        <span
          className={`text-6xl md:text-8xl font-light tracking-tight text-[#1A1A1A] splash-fetch ${
            phase >= 2 ? 'splash-fetch-active' : ''
          }`}
        >
          Fetch
        </span>
      </div>
    </div>
  );
}
