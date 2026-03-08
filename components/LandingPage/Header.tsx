"use client";

import { Button } from "../ui/button";
import Image from "next/image";
// 1. Import theme hooks and state handlers
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export function Header() {
  // 2. Setup theme reading state
  const { theme, systemTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  // 3. Define the dynamic logo source
  // Get the actual current theme (handles 'system' setting)
  const currentTheme = theme === 'system' ? systemTheme : theme;

  // Choose the logo path
  const logoSrc = (currentTheme === 'dark' || currentTheme === 'system' && systemTheme === 'dark')
    ? '/logo/DTG/DTGlogo_white.png'
    : '/logo/DTG/DTGlogo.png';

  // 4. Handle pre-mount rendering (prevents flicker)
  if (!mounted) {
    // Render a safe, placeholder header that matches the final structure
    return (
      <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--background)] border-b border-[var(--dtg-border-medium)]">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center animate-pulse"></div>
              <span className="text-xl font-semibold text-foreground w-64 h-6 animate-pulse bg-secondary rounded"></span>
            </div>
            {/* Desktop Nav Placeholder */}
            <nav className="flex items-center gap-8">
              <div className="w-16 h-6 bg-secondary rounded"></div>
              <div className="w-16 h-6 bg-secondary rounded"></div>
              <div className="w-24 h-9 bg-secondary rounded"></div>
            </nav>
          </div>
        </div>
      </header>
    );
  }

  // 5. Render the final component with dynamic logo (Post-Mount)
  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-sm bg-[var(--background)] border-b border-[var(--dtg-border-medium)]/50 dtg-transition">
      <div className="w-full px-15 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">

            {/* Logo and Text (Theme Swapped) */}
            <div className="w-20 h-10 rounded-full bg-secondary flex items-center justify-center dtg-transition">
              <Image
                // Use the dynamically determined source
                src={logoSrc}
                alt="Digital Twin Geotechnical"
                width={150}
                height={150}
                className="object-contain"
                onClick={()=>router.push("/")}
              />
            </div>
            <div>
              <span className="text-xl font-bold text-foreground pb-1">
                {/* Highlight the key part in Primary Teal */}
                <span className="text-[var(--dtg-primary-teal-dark)] mr-1">
                  Digital Twin
                </span>

                {/* Keep the industry part subtle */}
                Geotechnical
              </span>
              <div
                className="absolute bottom-0 left-0 right-0 h-[2px]" // h-[2px] sets the thickness
                style={{
                  // Use your custom gradient variables here. We'll use your primary teal.
                  // We'll replace '#00E0D9' with 'var(--primary)' for theme consistency.
                  background: `radial-gradient(circle at center, var(--dtg-primary-teal-dark), transparent)`,
                }}
              />
            </div>
          </div>
          
          {/* Desktop Navigation (Your preferred structure) */}
          <nav className="flex items-center gap-8">
            <button
              onClick={() => scrollToSection("services")}
              className="text-[var(--dtg-text-light)] hover:text-[var(--dtg-text-primary)] dtg-transition"
            >
              Services
            </button>
            <button
              onClick={() => scrollToSection("about")}
              className="text-[var(--dtg-text-light)] hover:text-[var(--dtg-text-primary)] dtg-transition"
            >
              About
            </button>
            <button
              onClick={() => scrollToSection("contact")}
              className="text-[var(--dtg-text-light)] hover:text-[var(--dtg-text-primary)] dtg-transition"
            >
              Contact
            </button>
            <Button
              variant="brand"
              onClick={() => router.push("/login")}
              className="dtg-transition"
            >
              Login
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}