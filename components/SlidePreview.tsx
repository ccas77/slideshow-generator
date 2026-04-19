"use client";

import { useState } from "react";

interface SlidePreviewProps {
  slides: string[];
  caption?: string;
  onClose: () => void;
}

export default function SlidePreview({ slides, caption, onClose }: SlidePreviewProps) {
  const [current, setCurrent] = useState(0);
  if (slides.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-xs mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Phone frame */}
        <div className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-gradient-to-br from-zinc-800 via-zinc-700 to-zinc-900 shadow-2xl border border-zinc-600">
          {/* Centered text */}
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center">
              <p className="text-white text-sm leading-relaxed font-medium drop-shadow-lg">
                {slides[current]}
              </p>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mt-6">
                Image generated at post time
              </div>
            </div>
          </div>

          {/* Slide counter */}
          <div className="absolute top-3 right-3 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full">
            {current + 1}/{slides.length}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            onClick={() => setCurrent(Math.max(0, current - 1))}
            disabled={current === 0}
            className="text-xs text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            &larr; Prev
          </button>
          <div className="flex gap-1">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === current ? "bg-white" : "bg-zinc-600"}`}
              />
            ))}
          </div>
          <button
            onClick={() => setCurrent(Math.min(slides.length - 1, current + 1))}
            disabled={current === slides.length - 1}
            className="text-xs text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            Next &rarr;
          </button>
        </div>

        {/* Caption */}
        {caption && (
          <div className="mt-3 text-xs text-zinc-400 bg-zinc-900/80 border border-zinc-800 rounded-lg p-3 max-h-20 overflow-y-auto">
            <span className="text-zinc-600 uppercase text-[10px] tracking-wide block mb-1">Caption</span>
            {caption}
          </div>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="mt-3 w-full text-xs text-zinc-500 hover:text-white transition-colors py-1"
        >
          Close preview
        </button>
      </div>
    </div>
  );
}
