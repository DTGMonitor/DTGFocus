"use client";

import { Button } from "../ui/button";
import { ArrowRight } from "lucide-react";
import Image from "next/image";

export function Hero() {

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Banner Image */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 dark:from-[#0a1414] dark:via-[#0c1818] dark:to-[#0a1414]">
        {/* Stars */}
        <div className="absolute inset-0">
          {[...Array(100)].map((_, i) => (
            <div
              key={i}
              className="absolute w-0.5 h-0.5 bg-white rounded-full opacity-60"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animation: `twinkle ${2 + Math.random() * 3}s infinite ${Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex w-full mx-auto px-20 z-10 justify-between items-center">
        <div className="max-w-4xl flex flex-col gap-6">
          <h1 className="text-6xl font-semibold text-white">
            Enhancing mining safety with advanced geotechnical monitoring technology.
          </h1>
          <p className="mb-10 max-w-2xl text-base font-normal text-white/80">
            Pioneering the future of geotechnical engineering with cutting-edge digital twin technology.
            Transform your infrastructure projects with real-time monitoring, predictive analytics, and data-driven insights.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-left">
            <Button
              variant="brand"
              onClick={()=>scrollToSection("services")}
              className="dtg-transition"
            >
              Get Started
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
            <Button
              onClick={()=>scrollToSection("contact")}
              variant="outline"
              className="dtg-transition"
            >
              Learn More
            </Button>
          </div>
        </div>
        <div className="text-center lg:text-left">
          {/* Logo with Glow Effect */}
          <div className="relative flex justify-center lg:justify-start mb-12">
            <div className="relative w-100 h-100">
              {/* Outer glow rings */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-teal-500/20 to-emerald-500/20 blur-3xl animate-pulse"></div>
              <div className="absolute inset-4 rounded-full bg-gradient-to-br from-teal-400/30 to-emerald-400/30 blur-2xl"></div>

              {/* Central orb */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-50 h-50 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 dark:from-[#1a2828] dark:to-[#0f1d1d] flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-teal-500/20 to-transparent"></div>

                  {/* Hexagon pattern */}
                  <div className="relative z-10">
                    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                      {/* Center hexagon */}
                      <path
                        d="M40 15 L52 22.5 L52 37.5 L40 45 L28 37.5 L28 22.5 Z"
                        fill="none"
                        stroke="url(#hexGradient)"
                        strokeWidth="2"
                      />
                      {/* Top-right hexagon */}
                      <path
                        d="M52 22.5 L64 30 L64 45 L52 52.5 L40 45 L40 30 Z"
                        fill="none"
                        stroke="url(#hexGradient)"
                        strokeWidth="2"
                        opacity="0.7"
                      />
                      {/* Top-left hexagon */}
                      <path
                        d="M28 22.5 L40 15 L40 30 L28 37.5 L16 30 L16 15 Z"
                        fill="none"
                        stroke="url(#hexGradient)"
                        strokeWidth="2"
                        opacity="0.7"
                      />
                      {/* Bottom hexagon */}
                      <path
                        d="M40 45 L52 52.5 L52 67.5 L40 75 L28 67.5 L28 52.5 Z"
                        fill="none"
                        stroke="url(#hexGradient)"
                        strokeWidth="2"
                        opacity="0.7"
                      />

                      {/* Center dot */}
                      <circle cx="40" cy="37.5" r="3" fill="#14b8a6" />

                      <defs>
                        <linearGradient id="hexGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#14b8a6" />
                          <stop offset="100%" stopColor="#10b981" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Ring border */}
              <div className="absolute inset-0 rounded-full border-2 border-teal-500/30"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 animate-bounce">
        <div className="w-6 h-10 border-2 border-teal-500/50 rounded-full flex items-start justify-center p-2">
          <div className="w-1.5 h-1.5 bg-teal-500 rounded-full"></div>
        </div>
      </div>
    </section>
  );
}