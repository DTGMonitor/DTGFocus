"use client";

import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Layers,
  Database,
  Activity,
  BarChart3,
  Shield,
  Zap,
} from "lucide-react";
import DTGFocus from '@/src/components/Icons/DTGFocus';
import PrismWatch from '@/src/components/Icons/PrismWatch';
import { useRouter } from "next/navigation";
import { useState } from "react";

export function Services() {
  const services = [
    {
      icon: DTGFocus,
      title: "DTG Focus",
      description:
        "Seamlessly integrate data from multiple sources including sensors, surveys, and historical records.",
      path: "/login"
    },
    {
      icon: Activity,
      title: "Pulse",
      description:
        "Continuous monitoring of ground conditions, structural integrity, and environmental factors with instant alerts.",
      path: ""
    },
    {
      icon: PrismWatch,
      title: "PrismWatch",
      description:
        "Create comprehensive digital twins of subsurface conditions with advanced 3D visualization and modeling capabilities.",
      path: ""
    },
    {
      icon: BarChart3,
      title: "Predictive Analytics",
      description:
        "Leverage AI and machine learning to predict ground behavior and identify potential risks before they occur.",
      path: ""
    },
    {
      icon: Shield,
      title: "Risk Assessment",
      description:
        "Comprehensive risk analysis and mitigation strategies for complex geotechnical challenges.",
      path: ""
    },
    {
      icon: Zap,
      title: "Performance Optimization",
      description:
        "Optimize design and construction processes with data-driven insights and simulation capabilities.",
      path: "/login"
    },
  ];

  const iconColor = 'var(--dtg-primary-teal-dark)';
  const router = useRouter();
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <section id="services" className="py-20 relative bg-[var(--background)]">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-teal-900/30 to-transparent"></div>
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-semibold mb-4 text-[var(--dtg-primary-teal-dark)]">
            Our Services
          </h2>
          <p className="max-w-2xl mx-auto text-[var(--dtg-text-secondary)]">
            Comprehensive digital twin solutions for modern geotechnical
            engineering challenges
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service, index) => {
            // 💡 3. SIMPLIFIED ICON LOGIC
            // Icon is always a React component now (either Lucide or your custom SVG)
            const IconComponent = service.icon;
            const scaleClass = hovered === index
              ? 'scale-[1.02]'
              : 'scale-100';

            return (
              <Card
                key={index}
                className={`
      border-1 border-teal-500 text-emerald-500 hover:bg-teal-600/30
      hover:border-teal-500/80 
      transition-all duration-300 
      hover:shadow-lg hover:shadow-teal-500/10
      
      transform 
      ${scaleClass}  // <-- Injecting the scale value
      ease-in-out 
      z-10         // <-- Good practice for hover elements
    `}
                onClick={() => router.push(service.path)}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              >
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-teal-500/10 flex items-center justify-center mb-4 overflow-hidden">
                    {/* 💡 4. RENDER THE ICON COMPONENT DIRECTLY */}
                    <IconComponent
                      className="w-6 h-6" // Keep w/h, but remove the text-[...] class
                      color={iconColor}
                      width={24}
                      height={24}
                    />
                  </div>
                  <CardTitle className="text-2xl font-semibold text-[var(--dtg-primary-teal-dark)]">{service.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-[var(--dtg-text-secondary)]">
                    {service.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
