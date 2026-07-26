"use client";

import { useState } from "react";

interface SlidePreviewProps {
  slides: string[];
  caption?: string;
  coverImage?: string;
  onClose: () => void;
}

export default function SlidePreview({ slides, caption, coverImage, onClose }: SlidePreviewProps) {
  const totalSlides = slides.length + (coverImage ? 1 : 0);
  const [current, setCurrent] = useState(0);
  if (totalSlides === 0) return null;

  const isCoverSlide = coverImage && current === totalSlides - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-xs mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Phone frame */}
        {/* Kept dark on purpose: this mirrors the posted slide, which is rendered
            on a #18181b background with white text (see lib/render-slide.ts). */}
        <div className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-gradient-to-br from-stone-800 via-stone-700 to-stone-900 shadow-2xl border border-stone-300">
          {isCoverSlide ? (
            /* Cover image slide */
            <img src={coverImage} alt="Book cover" className="absolute inset-0 w-full h-full object-contain bg-stone-900" />
          ) : (
            /* Text slide */
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="text-center">
                <p className="text-white text-sm leading-relaxed font-medium drop-shadow-lg">
                  {slides[current]}
                </p>
                <div className="text-[10px] text-stone-300 uppercase tracking-widest mt-6">
                  Image generated at post time
                </div>
              </div>
            </div>
          )}

          {/* Slide counter */}
          <div className="absolute top-3 right-3 bg-stone-900/60 text-white text-[10px] px-2 py-0.5 rounded-full">
            {current + 1}/{totalSlides}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            onClick={() => setCurrent(Math.max(0, current - 1))}
            disabled={current === 0}
            className="text-xs text-stone-300 hover:text-white disabled:opacity-30 transition-colors"
          >
            &larr; Prev
          </button>
          <div className="flex gap-1">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === current ? "bg-white" : "bg-white/40"}`}
              />
            ))}
          </div>
          <button
            onClick={() => setCurrent(Math.min(totalSlides - 1, current + 1))}
            disabled={current === totalSlides - 1}
            className="text-xs text-stone-300 hover:text-white disabled:opacity-30 transition-colors"
          >
            Next &rarr;
          </button>
        </div>

        {/* Caption */}
        {caption && (
          <div className="mt-3 text-xs text-stone-700 bg-white/90 border border-stone-200 rounded-lg p-3 max-h-20 overflow-y-auto">
            <span className="text-stone-400 uppercase text-[10px] tracking-wide block mb-1">Caption</span>
            {caption}
          </div>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="mt-3 w-full text-xs text-stone-300 hover:text-white transition-colors py-1"
        >
          Close preview
        </button>
      </div>
    </div>
  );
}
